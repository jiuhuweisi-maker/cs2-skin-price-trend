param(
    [Parameter(Mandatory=$true)][string]$WsUrl,
    [Parameter(Mandatory=$true)][string]$JsFile,
    [Parameter(Mandatory=$true)][string]$OutFile
)

$js = Get-Content -Raw -Encoding UTF8 $JsFile

$ws = New-Object System.Net.WebSockets.ClientWebSocket
$ws.ConnectAsync([Uri]$WsUrl, [Threading.CancellationToken]::None).Wait()

$payload = @{
    id = 1
    method = "Runtime.evaluate"
    params = @{
        expression   = $js
        returnByValue = $true
        awaitPromise  = $true
        timeout       = 120000
    }
} | ConvertTo-Json -Depth 6 -Compress

$bytes = [Text.Encoding]::UTF8.GetBytes($payload)
$seg = New-Object "System.ArraySegment[byte]" -ArgumentList @(,$bytes)
$ws.SendAsync($seg, [Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).Wait()

$buf = New-Object byte[] 131072
$ms = New-Object System.IO.MemoryStream
while ($true) {
    $s = New-Object "System.ArraySegment[byte]" -ArgumentList @(,$buf)
    $res = $ws.ReceiveAsync($s, [Threading.CancellationToken]::None).Result
    $ms.Write($buf, 0, $res.Count)
    if ($res.EndOfMessage) { break }
}
$text = [Text.Encoding]::UTF8.GetString($ms.ToArray())
$ms.Dispose()
$ws.Dispose()

$obj = $text | ConvertFrom-Json
if ($obj.result.exceptionDetails) {
    Write-Output ("EXCEPTION: " + ($obj.result.exceptionDetails | ConvertTo-Json -Depth 8 -Compress))
    exit 1
}
$value = $obj.result.result.value
if ($null -eq $value) {
    Write-Output ("NULL RESULT: " + ($obj.result | ConvertTo-Json -Depth 8 -Compress))
    exit 1
}
[IO.File]::WriteAllText($OutFile, [string]$value, (New-Object Text.UTF8Encoding($false)))
Write-Output ("OK bytes=" + ([string]$value).Length)
