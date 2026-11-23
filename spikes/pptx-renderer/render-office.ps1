param([Parameter(Mandatory = $true)][string]$FixtureDir, [Parameter(Mandatory = $true)][string]$OutputDir)

$ErrorActionPreference = 'Stop'
$running = [bool](Get-Process POWERPNT -ErrorAction SilentlyContinue)
if ($running) { throw 'Close PowerPoint before this isolated fixture trial.' }
$fixtureDir = (Resolve-Path -LiteralPath $FixtureDir).Path
$out = (New-Item -ItemType Directory -Force -Path $OutputDir).FullName
$app = $null
try {
  $cold = [Diagnostics.Stopwatch]::StartNew()
  $app = New-Object -ComObject PowerPoint.Application
  foreach ($case in @('wide', 'standard')) {
    $source = Join-Path $fixtureDir "$case.pptx"
    $hash = (Get-FileHash -LiteralPath $source).Hash
    $deck = $null
    $watch = [Diagnostics.Stopwatch]::StartNew()
    try {
      $deck = $app.Presentations.Open($source, -1, 0, 0) # ReadOnly, Untitled=no, WithWindow=no
      $width = $deck.PageSetup.SlideWidth
      $height = $deck.PageSetup.SlideHeight
      $pngWidth = [int][Math]::Round(900 * $width / $height)
      $wasHidden = @()
      for ($i = 1; $i -le $deck.Slides.Count; $i++) {
        $slide = $deck.Slides.Item($i)
        try {
          $wasHidden += ($slide.SlideShowTransition.Hidden -eq -1)
          $slide.Export((Join-Path $out "$case-$i.png"), 'PNG', $pngWidth, 900)
        } finally { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($slide) }
      }
      $pngMs = $watch.ElapsedMilliseconds
      $deck.SaveCopyAs((Join-Path $out "$case.pdf"), 32) # PDF: compare default handling of hidden slides
      [pscustomobject]@{
        Case = $case; SlideCount = $deck.Slides.Count; WidthPt = $width; HeightPt = $height;
        Hidden = $wasHidden; PngElapsedMs = $pngMs; TotalElapsedMs = $watch.ElapsedMilliseconds;
        SinceLaunchMs = $cold.ElapsedMilliseconds; Office = $app.Version
      } | ConvertTo-Json -Compress
    } finally {
      if ($deck) {
        $deck.Close()
        [void][Runtime.InteropServices.Marshal]::ReleaseComObject($deck)
      }
    }
    if ((Get-FileHash -LiteralPath $source).Hash -ne $hash) { throw 'Original fixture unexpectedly changed' }
  }
} finally {
  if ($app) {
    if ($app.Presentations.Count -eq 0) { $app.Quit() }
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($app)
  }
}
