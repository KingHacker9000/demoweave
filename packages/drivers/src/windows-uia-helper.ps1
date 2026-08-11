param(
  [Parameter(Mandatory = $true)]
  [string]$RequestBase64
)

$ErrorActionPreference = 'Stop'

function Write-ProtocolResponse {
  param([hashtable]$Response)
  [Console]::Out.WriteLine(($Response | ConvertTo-Json -Compress -Depth 8))
}

function Throw-ProtocolError {
  param([string]$Code, [string]$Message)
  throw "${Code}::${Message}"
}

function Get-AttachedWindow {
  param([int]$ProcessId)

  try {
    $process = [System.Diagnostics.Process]::GetProcessById($ProcessId)
  } catch {
    Throw-ProtocolError 'PROCESS_NOT_FOUND' "Process $ProcessId does not exist."
  }
  if (-not [Environment]::UserInteractive -or $process.SessionId -eq 0 -or $process.SessionId -ne [System.Diagnostics.Process]::GetCurrentProcess().SessionId) {
    Throw-ProtocolError 'INTERACTIVE_SESSION_UNAVAILABLE' "Process $ProcessId is not in the helper's interactive Windows session."
  }

  $condition = [System.Windows.Automation.PropertyCondition]::new(
    [System.Windows.Automation.AutomationElement]::ProcessIdProperty,
    $ProcessId
  )
  $candidates = @()
  $found = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
    [System.Windows.Automation.TreeScope]::Children,
    $condition
  )
  foreach ($element in $found) {
    try {
      if ($element.Current.NativeWindowHandle -ne 0 -and
          $element.Current.ControlType -eq [System.Windows.Automation.ControlType]::Window) {
        $candidates += $element
      }
    } catch {
      # A window disappearing during enumeration is not a plausible attachment candidate.
    }
  }
  if ($candidates.Count -eq 0) {
    Throw-ProtocolError 'NO_TOP_LEVEL_WINDOW' "Process $ProcessId exposes no top-level UI Automation window."
  }
  if ($candidates.Count -gt 1) {
    $names = @($candidates | ForEach-Object { $_.Current.Name }) -join ', '
    Throw-ProtocolError 'MULTIPLE_TOP_LEVEL_WINDOWS' "Process $ProcessId exposes multiple top-level UI Automation windows: $names"
  }
  return $candidates[0]
}

function Get-RoleControlType {
  param([string]$Role)
  switch ($Role.ToLowerInvariant()) {
    'button' { return [System.Windows.Automation.ControlType]::Button }
    'textbox' { return [System.Windows.Automation.ControlType]::Edit }
    'edit' { return [System.Windows.Automation.ControlType]::Edit }
    'text' { return [System.Windows.Automation.ControlType]::Text }
    'checkbox' { return [System.Windows.Automation.ControlType]::CheckBox }
    'combobox' { return [System.Windows.Automation.ControlType]::ComboBox }
    'list' { return [System.Windows.Automation.ControlType]::List }
    'listitem' { return [System.Windows.Automation.ControlType]::ListItem }
    'menuitem' { return [System.Windows.Automation.ControlType]::MenuItem }
    'tab' { return [System.Windows.Automation.ControlType]::Tab }
    'tabitem' { return [System.Windows.Automation.ControlType]::TabItem }
    default { Throw-ProtocolError 'UNSUPPORTED_TARGET_STRATEGY' "Unsupported Windows UI Automation role: $Role" }
  }
}

function Find-Target {
  param(
    [System.Windows.Automation.AutomationElement]$Window,
    [object]$Target,
    [bool]$AllowMissing
  )

  if ($Target.strategy -eq 'testId') {
    Throw-ProtocolError 'UNSUPPORTED_TARGET_STRATEGY' 'testId has no defined Windows UI Automation mapping.'
  }

  $matches = @()
  if ($Target.strategy -eq 'automationId' -or $Target.strategy -eq 'accessibilityId') {
    $condition = [System.Windows.Automation.PropertyCondition]::new(
      [System.Windows.Automation.AutomationElement]::AutomationIdProperty,
      [string]$Target.value
    )
    $matches = @($Window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition))
  } elseif ($Target.strategy -eq 'role') {
    $controlType = Get-RoleControlType ([string]$Target.value)
    $condition = [System.Windows.Automation.PropertyCondition]::new(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      $controlType
    )
    $matches = @($Window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition))
  } elseif (@('name', 'text', 'label') -contains $Target.strategy) {
    $all = $Window.FindAll(
      [System.Windows.Automation.TreeScope]::Descendants,
      [System.Windows.Automation.Condition]::TrueCondition
    )
    foreach ($element in $all) {
      try {
        $name = [string]$element.Current.Name
        $isMatch = if ($Target.exact -eq $true) { $name -ceq [string]$Target.value } else { $name.Contains([string]$Target.value) }
        if ($isMatch) { $matches += $element }
      } catch {
        # Ignore elements that disappear while traversing this application's subtree.
      }
    }
  } else {
    Throw-ProtocolError 'UNSUPPORTED_TARGET_STRATEGY' "Unsupported Windows UI Automation target strategy: $($Target.strategy)"
  }

  if ($matches.Count -eq 0) {
    if ($AllowMissing) { return $null }
    Throw-ProtocolError 'TARGET_NOT_FOUND' "No target matched $($Target.strategy)=$($Target.value) inside the attached application."
  }
  if ($matches.Count -gt 1) {
    Throw-ProtocolError 'TARGET_AMBIGUOUS' "Target $($Target.strategy)=$($Target.value) matched $($matches.Count) elements inside the attached application."
  }
  return $matches[0]
}

try {
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  Add-Type -AssemblyName System.Drawing
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class DemoWeaveNativeWindow {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
'@

  $requestBytes = [Convert]::FromBase64String($RequestBase64)
  $request = [Text.Encoding]::UTF8.GetString($requestBytes) | ConvertFrom-Json
  if (-not $request.operation -or -not $request.pid) {
    Throw-ProtocolError 'INVALID_REQUEST' 'Request requires operation and pid.'
  }
  $window = Get-AttachedWindow ([int]$request.pid)

  switch ($request.operation) {
    'attach' {
      Write-ProtocolResponse @{ ok = $true; window = @{ handle = $window.Current.NativeWindowHandle; name = $window.Current.Name } }
    }
    'activate' {
      $element = Find-Target $window $request.target $false
      $pattern = $null
      if (-not $element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
        Throw-ProtocolError 'ACTIVATION_PATTERN_UNAVAILABLE' 'Target does not expose UI Automation InvokePattern.'
      }
      ([System.Windows.Automation.InvokePattern]$pattern).Invoke()
      Write-ProtocolResponse @{ ok = $true }
    }
    'input' {
      $element = Find-Target $window $request.target $false
      $pattern = $null
      if (-not $element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) {
        Throw-ProtocolError 'VALUE_PATTERN_UNAVAILABLE' 'Target does not expose UI Automation ValuePattern.'
      }
      $valuePattern = [System.Windows.Automation.ValuePattern]$pattern
      if ($valuePattern.Current.IsReadOnly) {
        Throw-ProtocolError 'VALUE_PATTERN_UNAVAILABLE' 'Target ValuePattern is read-only.'
      }
      $nextValue = if ($request.clear -eq $true) { [string]$request.value } else { $valuePattern.Current.Value + [string]$request.value }
      $valuePattern.SetValue($nextValue)
      Write-ProtocolResponse @{ ok = $true }
    }
    'press' {
      $keys = @{
        Enter = '{ENTER}'; Tab = '{TAB}'; Escape = '{ESC}'; ArrowUp = '{UP}'; ArrowDown = '{DOWN}';
        ArrowLeft = '{LEFT}'; ArrowRight = '{RIGHT}'; Home = '{HOME}'; End = '{END}'
      }
      if (-not $keys.ContainsKey([string]$request.key)) {
        Throw-ProtocolError 'UNSUPPORTED_KEY' "Unsupported Windows key: $($request.key)"
      }

      $handle = [IntPtr]$window.Current.NativeWindowHandle
      [void][DemoWeaveNativeWindow]::SetForegroundWindow($handle)
      $window.SetFocus()
      if ($request.target) {
        $element = Find-Target $window $request.target $false
        $element.SetFocus()
      }
      Start-Sleep -Milliseconds 50

      $foreground = [DemoWeaveNativeWindow]::GetForegroundWindow()
      $foregroundProcessId = [uint32]0
      if ($foreground -eq [IntPtr]::Zero) {
        Throw-ProtocolError 'FOREGROUND_WINDOW_MISMATCH' 'Windows could not resolve a foreground window before key injection.'
      }
      [void][DemoWeaveNativeWindow]::GetWindowThreadProcessId($foreground, [ref]$foregroundProcessId)
      if ($foregroundProcessId -ne [uint32]$request.pid) {
        Throw-ProtocolError 'FOREGROUND_WINDOW_MISMATCH' "Refusing to send a key because the foreground window is not owned by process $($request.pid)."
      }

      [System.Windows.Forms.SendKeys]::SendWait($keys[[string]$request.key])
      Write-ProtocolResponse @{ ok = $true }
    }
    'inspect' {
      $element = Find-Target $window $request.target ([bool]$request.allowMissing)
      if ($null -eq $element) {
        Write-ProtocolResponse @{ ok = $true; element = @{ exists = $false } }
      } else {
        Write-ProtocolResponse @{ ok = $true; element = @{ exists = $true; visible = (-not $element.Current.IsOffscreen); name = $element.Current.Name } }
      }
    }
    'capture' {
      $handle = [IntPtr]$window.Current.NativeWindowHandle
      $rect = New-Object DemoWeaveNativeWindow+RECT
      if (-not [DemoWeaveNativeWindow]::GetWindowRect($handle, [ref]$rect)) {
        Throw-ProtocolError 'WINDOW_CAPTURE_FAILED' 'GetWindowRect failed for the attached application window.'
      }
      $width = $rect.Right - $rect.Left
      $height = $rect.Bottom - $rect.Top
      if ($width -le 0 -or $height -le 0) {
        Throw-ProtocolError 'WINDOW_CAPTURE_FAILED' "Attached application window has invalid dimensions ${width}x${height}."
      }
      $bitmap = New-Object System.Drawing.Bitmap($width, $height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
      $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
      $hdc = $graphics.GetHdc()
      try {
        if (-not [DemoWeaveNativeWindow]::PrintWindow($handle, $hdc, 2)) {
          Throw-ProtocolError 'WINDOW_CAPTURE_FAILED' 'PrintWindow failed for the attached application window.'
        }
      } finally {
        $graphics.ReleaseHdc($hdc)
        $graphics.Dispose()
      }
      $stream = New-Object System.IO.MemoryStream
      try {
        $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
        Write-ProtocolResponse @{
          ok = $true
          capture = @{ pngBase64 = [Convert]::ToBase64String($stream.ToArray()); width = $width; height = $height }
        }
      } finally {
        $stream.Dispose()
        $bitmap.Dispose()
      }
    }
    default { Throw-ProtocolError 'INVALID_REQUEST' "Unknown helper operation: $($request.operation)" }
  }
} catch {
  $message = $_.Exception.Message
  $separator = $message.IndexOf('::')
  if ($separator -gt 0) {
    Write-ProtocolResponse @{ ok = $false; error = @{ code = $message.Substring(0, $separator); message = $message.Substring($separator + 2) } }
  } else {
    Write-ProtocolResponse @{ ok = $false; error = @{ code = 'HELPER_UNAVAILABLE'; message = $message } }
  }
}
