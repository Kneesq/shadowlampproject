$ws = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath('Desktop')
$sc = $ws.CreateShortcut("$desktop\Shadow Lamp Generator.lnk")
$sc.TargetPath = Join-Path $PSScriptRoot 'start.bat'
$sc.WorkingDirectory = $PSScriptRoot
$sc.Description = "Shadow Lamp Generator"
$sc.Save()
Write-Host "Shortcut created on Desktop"
