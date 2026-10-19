$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskBitmap = New-Object Drawing.Bitmap 256,256
$taskGraphics = [Drawing.Graphics]::FromImage($taskBitmap)
$taskGraphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
$taskGraphics.Clear([Drawing.Color]::FromArgb(29,32,34))
$taskBrush = New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(220,183,138))
$taskFont = New-Object Drawing.Font 'Segoe UI',84,([Drawing.FontStyle]::Bold),([Drawing.GraphicsUnit]::Pixel)
$taskFormat = New-Object Drawing.StringFormat
$taskFormat.Alignment = [Drawing.StringAlignment]::Center
$taskFormat.LineAlignment = [Drawing.StringAlignment]::Center
$taskGraphics.DrawString('ST',$taskFont,$taskBrush,(New-Object Drawing.RectangleF 0,0,256,256),$taskFormat)
$taskStream = New-Object IO.MemoryStream
$taskBitmap.Save($taskStream,[Drawing.Imaging.ImageFormat]::Png)
$taskPng = $taskStream.ToArray()
$taskIcon = New-Object IO.MemoryStream
$taskWriter = New-Object IO.BinaryWriter($taskIcon)
$taskWriter.Write([uint16]0); $taskWriter.Write([uint16]1); $taskWriter.Write([uint16]1)
$taskWriter.Write([byte]0); $taskWriter.Write([byte]0); $taskWriter.Write([byte]0); $taskWriter.Write([byte]0)
$taskWriter.Write([uint16]1); $taskWriter.Write([uint16]32); $taskWriter.Write([uint32]$taskPng.Length); $taskWriter.Write([uint32]22)
$taskWriter.Write($taskPng)
[IO.File]::WriteAllBytes((Join-Path $taskRoot 'resources\icon.ico'),$taskIcon.ToArray())
$taskWriter.Dispose(); $taskIcon.Dispose(); $taskStream.Dispose(); $taskGraphics.Dispose(); $taskBitmap.Dispose(); $taskBrush.Dispose(); $taskFont.Dispose()
