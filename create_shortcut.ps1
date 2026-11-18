$ws = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath('Desktop')
$sc = $ws.CreateShortcut("$desktop\Shadow Lamp Generator.lnk")
$sc.TargetPath = "C:\Users\ASUSTek\.gemini\antigravity-ide\scratch\shadow_lamp_generator\start.bat"
$sc.WorkingDirectory = "C:\Users\ASUSTek\.gemini\antigravity-ide\scratch\shadow_lamp_generator"
$sc.Description = "Shadow Lamp Generator"
$sc.Save()
Write-Host "Shortcut created on Desktop"
