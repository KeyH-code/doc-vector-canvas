"""Exercise a version-pinned, local browser bundle without installing it in the app."""

import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright


def render(fixtures, vendor, output):
    output.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        edge = playwright.chromium.launch(channel="msedge")
        for case, width in (("wide", 1600), ("standard", 1200)):
            context = edge.new_context(viewport={"width": width + 20, "height": 930}, offline=True)
            outbound, errors = [], []

            def block(route):
                outbound.append(route.request.url)
                route.abort()

            context.route("http://**/*", block)
            context.route("https://**/*", block)
            page = context.new_page()
            page.clock.install()
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.set_content('<style>body{margin:0}#fixture{display:none}</style><input type="file" id="fixture"><div id="wrapper"></div>')
            page.add_script_tag(path=vendor)
            page.locator("#fixture").set_input_files(fixtures / f"{case}.pptx")
            result = page.evaluate("""async (width) => {
                const previewer = window.pptxPreview.init(document.querySelector('#wrapper'), {width, height: 900, mode: 'list'});
                const file = document.querySelector('#fixture').files[0];
                const t = performance.now();
                try {
                    const deck = await previewer.preview(await file.arrayBuffer());
                    await document.fonts.ready;
                    await Promise.allSettled([...document.images].map(x => x.decode()));
                    return { slides: deck.slides.length, width: deck.width, height: deck.height, ms: Math.round(performance.now()-t) };
                } catch (error) { return { error: String(error) }; }
            }""", width)
            wrappers = page.locator('#wrapper [class*="pptx-preview-slide-wrapper-"]')
            result.update(case=case, errors=errors, outbound=outbound, wrappers=wrappers.count())
            if not result.get("error"):
                page.clock.run_for(1800)  # Let ECharts settle before capturing its static result.
                for index, slide in enumerate(wrappers.all(), 1):
                    slide.screenshot(path=output / f"{case}-{index}.png", animations="disabled", timeout=12000)
            print(json.dumps(result, ensure_ascii=True))
            context.close()
        edge.close()


if __name__ == "__main__":
    render(*map(Path, sys.argv[1:]))
