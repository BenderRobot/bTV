param([Parameter(Mandatory=$true)][string]$Path,[string]$ExpectedAppId='bfgs9jFN9d.MyIPtv')
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive=[IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $Path).Path)
try {
    $names=New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    foreach ($entry in $archive.Entries) {
        $name=$entry.FullName.Replace('\','/')
        if (-not $names.Add($name)) { throw "Duplicate packaged path: $name" }
        if ($name.StartsWith('/') -or $name -match '(^|/)(\.\.?|\.git|node_modules|test|tools)(/|$)' -or
            $name -match '(^|/)(\.env(?:\..*)?|local\.properties|keystore\.properties|\.tizen-deploy-state\.json)$' -or
            $name -match '\.(ps1|jks|keystore|p12|pfx|pem|key)$') { throw "Unexpected private/development file in WGT: $name" }
    }
    foreach ($required in @('index.html','config.xml','author-signature.xml','signature1.xml')) {
        if (-not $names.Contains($required)) { throw "Missing packaged file: $required" }
    }
    function Read-Entry([string]$Name) {
        $reader=New-Object IO.StreamReader($archive.GetEntry($Name).Open())
        try { $reader.ReadToEnd() } finally { $reader.Dispose() }
    }
    [xml]$xml=Read-Entry 'config.xml'
    $ns=New-Object System.Xml.XmlNamespaceManager($xml.NameTable)
    $ns.AddNamespace('tizen','http://tizen.org/ns/widgets')
    if ($xml.SelectSingleNode('//tizen:application',$ns).id -ne $ExpectedAppId) { throw 'Unexpected packaged app identity.' }
    $html=Read-Entry 'index.html'
    foreach ($match in [regex]::Matches($html,'(?i)<script\b[^>]*\bsrc="([^"]+)"')) {
        $script=$match.Groups[1].Value
        if ($script -notmatch '^js/[\w/.-]+\.js$' -or -not $names.Contains($script)) { throw 'Remote or missing packaged script.' }
    }
    Write-Host ("WGT content verified: {0} entries, app {1}." -f $archive.Entries.Count,$ExpectedAppId)
} finally { $archive.Dispose() }
