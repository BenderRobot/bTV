$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$folder=Join-Path ([IO.Path]::GetTempPath()) ('btv-wgt-tests-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $folder | Out-Null
$count=0
try {
    foreach ($bad in @('', '.git/objects/pack/private.pack', 'node_modules/dependency.js', 'keys/signing.p12', '../outside.txt', 'tools/deploy.ps1')) {
        $file=Join-Path $folder (([guid]::NewGuid().ToString('N')) + '.wgt')
        $zip=[IO.Compression.ZipFile]::Open($file,'Create')
        try {
            $contents=@{
                'index.html'='<script src="js/app.js"></script>'
                'config.xml'='<widget xmlns:tizen="http://tizen.org/ns/widgets"><tizen:application id="bfgs9jFN9d.MyIPtv"/></widget>'
                'js/app.js'='/* fixture */'
                'author-signature.xml'='fixture presence only'
                'signature1.xml'='fixture presence only'
            }
            if ($bad) { $contents[$bad]='must not ship' }
            foreach ($name in $contents.Keys) {
                $entry=$zip.CreateEntry($name)
                $writer=New-Object IO.StreamWriter($entry.Open())
                try { $writer.Write($contents[$name]) } finally { $writer.Dispose() }
            }
        } finally { $zip.Dispose() }
        $rejected=$false
        try { & (Join-Path $PSScriptRoot 'verify-wgt.ps1') -Path $file } catch { $rejected=$true }
        if ($rejected -ne [bool]$bad) { throw "Unexpected package guard result: $bad" }
        $count++
    }
    Write-Host "$count WGT content tests passed (fixture signatures are not cryptographic tests)."
} finally {
    $absolute=[IO.Path]::GetFullPath($folder)
    $temporary=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if ($absolute.StartsWith($temporary,[StringComparison]::OrdinalIgnoreCase) -and [IO.Path]::GetFileName($absolute) -match '^btv-wgt-tests-[a-f0-9]{32}$') { Remove-Item -LiteralPath $absolute -Recurse -Force }
}
