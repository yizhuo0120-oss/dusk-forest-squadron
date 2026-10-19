param([int]$Port = 8765, [switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
$rootPath = [IO.Path]::GetFullPath($PSScriptRoot)
$rootPrefix = $rootPath.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
$listener = $null
for ($candidate = $Port; $candidate -lt ($Port + 20); $candidate++) {
    try {
        $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $candidate)
        $listener.Start()
        $Port = $candidate
        break
    } catch {
        $listener = $null
    }
}
if ($null -eq $listener) { throw 'No free local port was found.' }

$url = "http://localhost:$Port/m2/"
Write-Host "Dusk Forest Squadron - offline demo"
Write-Host "Open: $url"
Write-Host 'Keep this window open while playing. Close it when finished.'
Write-Host 'The server listens on this computer only. No internet connection is needed.'
if (-not $NoBrowser) { Start-Process $url }

$mimeTypes = @{
    '.html' = 'text/html; charset=utf-8'; '.js' = 'application/javascript';
    '.mjs' = 'application/javascript'; '.css' = 'text/css';
    '.wasm' = 'application/wasm'; '.gz' = 'application/gzip';
    '.glb' = 'model/gltf-binary'; '.png' = 'image/png';
    '.svg' = 'image/svg+xml'; '.mp4' = 'video/mp4'
}

try {
    while ($true) {
        $client = $listener.AcceptTcpClient()
        $client.ReceiveTimeout = 2000
        $client.SendTimeout = 10000
        try {
            $network = $client.GetStream()
            $reader = [IO.StreamReader]::new($network, [Text.Encoding]::ASCII, $false, 4096, $true)
            $request = $reader.ReadLine()
            if (-not $request) { continue }
            $parts = $request.Split(' ')
            if ($parts.Length -lt 2) { continue }
            $method = $parts[0]
            $headerBytes = $request.Length
            while ($line = $reader.ReadLine()) {
                $headerBytes += $line.Length
                if ($headerBytes -gt 16384) { throw 'Request headers are too large.' }
            }
            $relative = [Uri]::UnescapeDataString(($parts[1] -split '\?', 2)[0]).TrimStart('/')
            $path = [IO.Path]::GetFullPath((Join-Path $rootPath $relative))
            $allowed = ($path -eq $rootPath) -or $path.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)
            $status = '200 OK'
            $body = $null
            if (-not $allowed) { $status = '403 Forbidden' }
            elseif ($method -notin @('GET', 'HEAD')) { $status = '405 Method Not Allowed' }
            else {
                if ([IO.Directory]::Exists($path)) { $path = Join-Path $path 'index.html' }
                if ([IO.File]::Exists($path)) {
                    $body = [IO.File]::OpenRead($path)
                } else { $status = '404 Not Found' }
            }
            $length = 0
            $mime = 'application/octet-stream'
            if ($null -ne $body) {
                $length = $body.Length
                $extension = [IO.Path]::GetExtension($path).ToLowerInvariant()
                if ($mimeTypes.ContainsKey($extension)) { $mime = $mimeTypes[$extension] }
            }
            $headers = "HTTP/1.1 $status`r`nContent-Type: $mime`r`nContent-Length: $length`r`nCache-Control: no-cache`r`nConnection: close`r`n`r`n"
            $headerData = [Text.Encoding]::ASCII.GetBytes($headers)
            $network.Write($headerData, 0, $headerData.Length)
            if ($null -ne $body) {
                try { if ($method -ne 'HEAD') { $body.CopyTo($network) } }
                finally { $body.Dispose() }
            }
        } catch {
            # Abandoned browser preconnections and canceled requests are harmless.
        } finally {
            $client.Close()
        }
    }
} finally {
    $listener.Stop()
}
