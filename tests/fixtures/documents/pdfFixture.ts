/** Small real two-page PDF with a landscape second page and selectable text. */
export function pdfFixture() {
  const stream = (s: string) => `<< /Length ${s.length} >>\nstream\n${s}\nendstream`
  const parts = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 300] /Contents 5 0 R /Resources << /Font << /F1 7 0 R >> >> >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 340 240] /CropBox [10 20 330 220] /Rotate 90 /Contents 6 0 R /Resources << /Font << /F1 7 0 R >> >> >>',
    stream('1 0.8 0 rg 0 260 40 40 re f\nBT /F1 16 Tf 35 200 Td (FIRST BASE TEXT) Tj ET'),
    stream('0 0.6 0.2 rg 10 20 30 30 re f\nBT /F1 16 Tf 65 100 Td (SECOND BASE TEXT) Tj ET'),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let source = '%PDF-1.4\n'
  const offsets: number[] = []
  parts.forEach((part, i) => { offsets.push(source.length); source += `${i + 1} 0 obj\n${part}\nendobj\n` })
  const xref = source.length
  source += `xref\n0 ${parts.length + 1}\n0000000000 65535 f \n${offsets.map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}`
  return Buffer.from(`${source}trailer\n<< /Root 1 0 R /Size ${parts.length + 1} >>\nstartxref\n${xref}\n%%EOF\n`, 'ascii')
}
