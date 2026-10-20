param(
    [Parameter(Mandatory=$true)][string]$WsUrl,
    [Parameter(Mandatory=$true)][string]$OutFile
)

$ws = New-Object System.Net.WebSockets.ClientWebSocket
$ws.ConnectAsync([Uri]$WsUrl, [Threading.CancellationToken]::None).Wait()

$payload = '{"id":1,"method":"Network.getAllCookies","params":{}}'
$bytes = [Text.Encoding]::UTF8.GetBytes($payload)
$seg = New-Object "System.ArraySegment[byte]" -ArgumentList @(,$bytes)
$ws.SendAsync($seg, [Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).Wait()

$buf = New-Object byte[] 1048576
$ms = New-Object System.IO.MemoryStream
while ($true) {
    $s = New-Object "System.ArraySegment[byte]" -ArgumentList @(,$buf)
    $res = $ws.ReceiveAsync($s, [Threading.CancellationToken]::None).Result
    $ms.Write($buf, 0, $res.Count)
    if ($res.EndOfMessage) { break }
}
$text = [Text.Encoding]::UTF8.GetString($ms.ToArray())
$ms.Dispose(); $ws.Dispose()

$obj = $text | ConvertFrom-Json
$cookies = $obj.result.cookies | Where-Object { $_.domain -like "*163.com*" }
$cookies | ForEach-Object { "{0}={1}" -f $_.name, $_.value } | Sort-Object -Unique | Set-Content -Encoding UTF8 $OutFile
Write-Output ("cookies=" + $cookies.Count)
$cookies | Select-Object name, domain, expires | Format-Table -AutoSize
