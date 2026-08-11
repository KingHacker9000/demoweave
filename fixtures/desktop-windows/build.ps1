param()

$ErrorActionPreference = 'Stop'
$compiler = Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) {
  $compiler = Join-Path $env:SystemRoot 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
}
if (-not (Test-Path -LiteralPath $compiler)) {
  throw 'The built-in .NET Framework C# compiler is unavailable.'
}

$outputDirectory = Join-Path $PSScriptRoot 'bin'
[void](New-Item -ItemType Directory -Path $outputDirectory -Force)
$arguments = @(
  '/nologo', '/target:winexe', '/optimize+', "/out:$outputDirectory\DesktopWindowsFixture.exe",
  '/reference:System.dll', '/reference:System.Drawing.dll', '/reference:System.Windows.Forms.dll',
  '/reference:System.Web.Extensions.dll', (Join-Path $PSScriptRoot 'app.cs')
)
$compilerProcess = Start-Process -FilePath $compiler -ArgumentList $arguments -Wait -PassThru -NoNewWindow
if ($compilerProcess.ExitCode -ne 0) { throw "C# compiler exited with code $($compilerProcess.ExitCode)" }
