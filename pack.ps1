# 打商店提交包。
#
# 不用 Compress-Archive：PowerShell 5.1 在 Windows 上会把条目名写成反斜杠
# （background\sw.js），而 ZIP 规范要求正斜杠。有些解包实现会把整个路径
# 当成一个文件名，目录结构就废了 —— 而且不报错，要到商店解包后才发现。
# 所以逐个条目手工写入，路径显式转成正斜杠。

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$dist = Join-Path $root 'dist'
if (-not (Test-Path $dist)) { throw "没有 dist/，先跑 npm run build" }

$ver = (Get-Content (Join-Path $dist 'manifest.json') -Raw | ConvertFrom-Json).version
$relDir = Join-Path $root 'release'
New-Item -ItemType Directory -Force -Path $relDir | Out-Null
$out = Join-Path $relDir "shuhen-$ver.zip"
if (Test-Path $out) { Remove-Item $out -Force }

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$zip = [System.IO.Compression.ZipFile]::Open($out, 'Create')
try {
  $prefix = (Resolve-Path $dist).Path.TrimEnd('\') + '\'
  Get-ChildItem -Path $dist -Recurse -File | ForEach-Object {
    $name = $_.FullName.Substring($prefix.Length).Replace('\', '/')
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
      $zip, $_.FullName, $name, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
} finally { $zip.Dispose() }

$fi = Get-Item $out
Write-Output ("包   : " + $fi.FullName)
Write-Output ("大小 : " + [math]::Round($fi.Length / 1KB, 1) + " KB")

# 自查：条目名里不许出现反斜杠，manifest.json 必须在根
$zr = [System.IO.Compression.ZipFile]::OpenRead($out)
try {
  $names = $zr.Entries | ForEach-Object { $_.FullName }
  $bad = $names | Where-Object { $_ -like '*\*' }
  if ($bad) { throw ("条目名含反斜杠：" + ($bad -join ', ')) }
  if ($names -notcontains 'manifest.json') { throw "manifest.json 不在包根目录" }
  Write-Output "内容 :"
  $names | Sort-Object | ForEach-Object { Write-Output ("  " + $_) }
  Write-Output "自查 : 路径分隔符正确，manifest.json 在根目录"
} finally { $zr.Dispose() }
