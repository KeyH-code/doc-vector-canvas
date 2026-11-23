"""Test @web-ppt/core PNG blobs in an offline Edge page, no screenshot-based export."""

import base64
import json
import sys
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright


ORIGIN = "https://m3-pptx-fixture.invalid"
HTML = """<!doctype html><meta charset=utf-8>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data: blob:; connect-src data: blob:; worker-src blob:;">
<script type=importmap>{"imports":{"fflate":"/fflate.js"}}</script>
<input type=file id=fixture>
<script type=module>
  import { parse, slideToPng } from '/dist/core.js';
  window.runFixture = async () => {
    const file = document.querySelector('#fixture').files[0];
    const bytes = await file.arrayBuffer();
    const t = performance.now();
    let deck;
    try {
      deck = await parse(bytes, { lazy: false, zip: { maxEntries: 2000, maxTotalBytes: 128 * 1024 * 1024 } });
      const pages = [];
      for (const slide of deck.slides) {
        const png = await slideToPng(deck, slide, 900 / deck.height, { strictResources: true });
        const data = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result.split(',')[1]);
          reader.onerror = reject;
          reader.readAsDataURL(png);
        });
        pages.push({ data, hidden: !!slide.hidden, bytes: png.size });
      }
      const rejected = {};
      for (const [name, task] of [
        ['damaged', () => parse(bytes.slice(0, 200))],
        ['limit', () => parse(bytes, { zip: { maxEntries: 1 } })],
      ]) {
        try { (await task()).dispose?.(); rejected[name] = false; }
        catch (error) { rejected[name] = error.reason ?? error.name; }
      }
      return { width: deck.width, height: deck.height, pages, rejected, ms: Math.round(performance.now() - t) };
    } finally { deck?.dispose?.(); }
  };
  window.checkExternal = async () => {
    const deck = await parse(await document.querySelector('#fixture').files[0].arrayBuffer(), {lazy: false});
    try {
      const png = await slideToPng(deck, deck.slides[0], 900 / deck.height, {strictResources: true});
      return { bytes: png.size, externalElement: JSON.stringify(deck.slides[0]).includes('example.invalid') };
    } catch (error) { return { error: String(error) }; }
    finally { deck.dispose?.(); }
  };
</script>"""


def render(fixtures, vendor, output):
    output.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        edge = playwright.chromium.launch(channel="msedge")
        for case in ("wide", "standard", "external"):
            context = edge.new_context(offline=True)
            outbound, errors, console_errors = [], [], []

            def route(request):
                url = urlsplit(request.request.url)
                if f"{url.scheme}://{url.netloc}" != ORIGIN:
                    outbound.append(request.request.url)
                    return request.abort()
                if url.path == "/":
                    return request.fulfill(content_type="text/html; charset=utf-8", body=HTML)
                if url.path == "/fflate.js":
                    return request.fulfill(content_type="text/javascript", path=vendor / "fflate/esm/browser.js")
                path = Path(url.path)
                if path.parent.as_posix() == "/dist" and path.suffix == ".js":
                    target = vendor / "webppt/dist" / path.name
                    if target.is_file():
                        return request.fulfill(content_type="text/javascript", path=target)
                request.abort()

            context.route("http://**/*", route)
            context.route("https://**/*", route)
            page = context.new_page()
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.on("console", lambda msg: console_errors.append(msg.text) if msg.type in ("warning", "error") else None)
            page.goto(ORIGIN)
            page.locator("#fixture").set_input_files(fixtures / f"{case}.pptx")
            page.wait_for_function("typeof window.runFixture === 'function'", timeout=10000)
            if case == "external":
                result = page.evaluate("window.checkExternal()")
                print(json.dumps(dict(result, case=case, outbound=outbound, errors=errors, console_errors=console_errors)))
                assert 'example.invalid' in result.get('error', '') and not outbound and not errors
                context.close()
                continue
            result = page.evaluate("window.runFixture()")
            for index, item in enumerate(result['pages'], 1):
                data = base64.b64decode(item.pop("data"), validate=True)
                assert len(data) == item["bytes"]
                (output / f"{case}-{index}.png").write_bytes(data)
            result.update(case=case, outbound=outbound, errors=errors, console_errors=console_errors)
            print(json.dumps(result, ensure_ascii=True))
            assert len(result["pages"]) == 3 and result["pages"][2]["hidden"]
            assert all(result["rejected"].values()) and not outbound and not errors
            context.close()
        edge.close()


if __name__ == "__main__":
    render(*map(Path, sys.argv[1:]))
