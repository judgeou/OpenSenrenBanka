param([string]$LibraryDirectory, [ValidateSet('Resources', 'Images')][string]$Tool = 'Resources')
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath([IO.Path]::Combine($PSScriptRoot, '..', '..'))
$toolchain = [IO.Path]::Combine($workspace, 'work', 'toolchain')
if ([string]::IsNullOrEmpty($LibraryDirectory)) { $LibraryDirectory = [IO.Path]::Combine($toolchain, 'garbro-1.5.44') }
$library = (Resolve-Path -LiteralPath $LibraryDirectory).Path
$allowedPrefix = $toolchain.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
if (-not ($library + [IO.Path]::DirectorySeparatorChar).StartsWith($allowedPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Library directory must be inside this workspace toolchain directory'
}
$imageTool = $Tool -eq 'Images'
$targetName = if ($imageTool) { 'SenrenImagePrepare.exe' } else { 'SenrenResourceExtract.exe' }
$sourceName = if ($imageTool) { 'PrepareWebImages.cs' } else { 'GarbroResourceExtract.cs' }
$target = [IO.Path]::Combine($library, $targetName)
if (Test-Path -LiteralPath $target) { throw 'Refusing to overwrite an existing bridge binary' }
$compiler = [IO.Path]::Combine($env:WINDIR, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe')
$source = [IO.Path]::Combine($PSScriptRoot, $sourceName)
$sources = @($source)
if ($imageTool) { $sources += [IO.Path]::Combine($PSScriptRoot, 'TlgTailMetadata.cs') }
$extraReferences = @()
if ($imageTool) {
    $framework = [IO.Path]::GetDirectoryName($compiler)
    $extraReferences = @('/reference:System.Xaml.dll',
        ('/reference:' + [IO.Path]::Combine($framework, 'WPF', 'PresentationCore.dll')),
        ('/reference:' + [IO.Path]::Combine($framework, 'WPF', 'WindowsBase.dll')))
}
$references = @('GameRes.dll', 'ArcFormats.dll') | ForEach-Object { '/reference:' + [IO.Path]::Combine($library, $_) }
& $compiler /nologo /target:exe /platform:x64 /codepage:65001 ('/out:' + $target) @references @extraReferences /reference:System.Core.dll /reference:System.Runtime.Serialization.dll /reference:System.ComponentModel.Composition.dll @sources
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Output $target
