# Builds Lili, the screen saver app, with nothing but the Android SDK build-tools
# and a JDK - the same pipeline as tools\build-apk.ps1, pointed at android-saver\.
#
#   powershell -ExecutionPolicy Bypass -File tools\build-saver-apk.ps1            debug APK
#   powershell -ExecutionPolicy Bypass -File tools\build-saver-apk.ps1 -Overlay   with the fps/state overlay
#   powershell -ExecutionPolicy Bypass -File tools\build-saver-apk.ps1 -Install   and adb install it
#   powershell -ExecutionPolicy Bypass -File tools\build-saver-apk.ps1 -Release   signed for publishing
#
# Output: android-saver\build\lili-screensaver-<version>[-debug].apk
# The version is android-saver\VERSION (major.minor.patch); the manifest has none.
#
# -Release signs with .local\release.keystore (gitignored), alias from
# $env:LILI_KEY_ALIAS (default 'lili'), passwords from $env:LILI_KS_PASS and
# $env:LILI_KEY_PASS - handed to apksigner by name, so they never appear on a
# command line. It never creates the keystore: if anything is missing it stops
# before building and prints the command to run once.

param(
    [switch]$Install,          # adb install -r when done, then open the setup screen
    [switch]$Overlay,          # bake in the on-screen fps/state overlay (debug only)
    [switch]$Release,          # sign with the release keystore
    [int]$MinSdk = 21,         # Android 5.0
    [int]$TargetSdk = 34
)

# ---------------------------------------------------------------- identity
# THE APPLICATION ID, in one place. It is what Android and every installed copy
# know the app by, so it is permanent once an APK is public. The Java classes
# stay in com.lili.saver whatever this says: aapt2 renames only the manifest's
# package (--rename-manifest-package) and fully qualifies the class names.
$AppId = 'com.lili.saver'

# Native tools write notes and warnings to stderr; with 'Stop' PowerShell turns
# those into terminating errors. Every external call below checks $LASTEXITCODE.
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root 'android-saver'
$outDir = Join-Path $src 'build'
$tmp = Join-Path $outDir 'tmp'

function Fail($m) { Write-Host "FAILED: $m" -ForegroundColor Red; exit 1 }
function Step($m) { Write-Host "-> $m" -ForegroundColor Cyan }

# ---------------------------------------------------------------- version
$versionFile = Join-Path $src 'VERSION'
if (-not (Test-Path $versionFile)) { Fail "missing $versionFile" }
$version = (Get-Content $versionFile -Raw).Trim()
if ($version -notmatch '^(\d+)\.(\d+)\.(\d+)$') { Fail "VERSION must be major.minor.patch, not '$version'" }
$versionCode = [int]$Matches[1] * 10000 + [int]$Matches[2] * 100 + [int]$Matches[3]
if ($Release) { $apkName = "lili-screensaver-$version.apk" } else { $apkName = "lili-screensaver-$version-debug.apk" }
$final = Join-Path $outDir $apkName

# ---------------------------------------------------------------- toolchain
$sdk = $env:ANDROID_HOME
if (-not $sdk) { $sdk = $env:ANDROID_SDK_ROOT }
if (-not $sdk) { $sdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
if (-not (Test-Path $sdk)) { Fail "Android SDK not found. Set ANDROID_HOME." }

$bt = Get-ChildItem (Join-Path $sdk 'build-tools') -Directory |
      Sort-Object { [version]($_.Name -replace '[^0-9.].*$','') } | Select-Object -Last 1
if (-not $bt) { Fail "no build-tools in $sdk" }

$platform = Get-ChildItem (Join-Path $sdk 'platforms') -Directory |
            Where-Object { Test-Path (Join-Path $_.FullName 'android.jar') } |
            Sort-Object Name | Select-Object -Last 1
if (-not $platform) { Fail "no platform with android.jar in $sdk" }

$aapt2     = Join-Path $bt.FullName 'aapt2.exe'
$d8        = Join-Path $bt.FullName 'd8.bat'
$zipalign  = Join-Path $bt.FullName 'zipalign.exe'
$apksigner = Join-Path $bt.FullName 'apksigner.bat'
$androidJar = Join-Path $platform.FullName 'android.jar'

$jdk = $env:JAVA_HOME
if (-not $jdk) { $jdk = Split-Path -Parent (Split-Path -Parent (Get-Command java).Source) }
$javac = Join-Path $jdk 'bin\javac.exe'
$jar = Join-Path $jdk 'bin\jar.exe'
$keytool = Join-Path $jdk 'bin\keytool.exe'
foreach ($t in @($aapt2,$d8,$zipalign,$apksigner,$androidJar,$javac,$jar,$keytool)) {
    if (-not (Test-Path $t)) { Fail "missing tool: $t" }
}

# ---------------------------------------------------------------- signing, decided first
# A release build is checked before anything is built, so a missing key costs
# nothing and leaves no half-made APK behind.
if ($Release) {
    if ($Overlay) { Fail '-Release and -Overlay do not mix: the overlay is for debugging.' }
    $ks = Join-Path $root '.local\release.keystore'
    $alias = $env:LILI_KEY_ALIAS
    if (-not $alias) { $alias = 'lili' }
    $missing = @()
    if (-not (Test-Path $ks)) { $missing += "the keystore $ks" }
    if (-not $env:LILI_KS_PASS) { $missing += 'the environment variable LILI_KS_PASS (keystore password)' }
    if (-not $env:LILI_KEY_PASS) { $missing += 'the environment variable LILI_KEY_PASS (key password)' }
    if ($missing.Count) {
        Write-Host ''
        Write-Host 'Release signing is not set up. Missing:' -ForegroundColor Red
        foreach ($m in $missing) { Write-Host "  - $m" -ForegroundColor Red }
        Write-Host ''
        Write-Host 'The release key is the app''s identity: every update must be signed with it,'
        Write-Host 'and if it is lost, everyone has to uninstall to update. Create it ONCE:'
        Write-Host ''
        Write-Host "  & '$keytool' -genkeypair -v -keystore '$ks' -alias $alias -keyalg RSA -keysize 4096 -validity 36500 -dname 'CN=Lili Screensaver'" -ForegroundColor Yellow
        Write-Host ''
        Write-Host 'then back that file up somewhere outside this repository. Before each release,'
        Write-Host 'in the same PowerShell window (Read-Host keeps the passwords out of the history):'
        Write-Host ''
        Write-Host "  `$env:LILI_KS_PASS  = Read-Host 'keystore password'" -ForegroundColor Yellow
        Write-Host "  `$env:LILI_KEY_PASS = `$env:LILI_KS_PASS     # keytool's default PKCS12 store uses one password for both" -ForegroundColor Yellow
        Write-Host "  `$env:LILI_KEY_ALIAS = '$alias'              # optional; 'lili' is the default" -ForegroundColor Yellow
        Write-Host ''
        Fail 'release signing not set up - no APK was built.'
    }
    $dirty = & git -C $root status --porcelain 2>$null
    if ($dirty) {
        Write-Warning 'the working tree has uncommitted changes - this release will not match any commit.'
    }
} else {
    $ks = Join-Path $root 'android\keystore\debug.keystore'
}

Write-Host "Lili screensaver $version (code $versionCode)  id $AppId  $(if ($Release) {'RELEASE'} else {'debug'})" -ForegroundColor White
Write-Host "build-tools $($bt.Name)   platform $($platform.Name)   jdk $(Split-Path -Leaf $jdk)" -ForegroundColor DarkGray

# ---------------------------------------------------------------- 1. the page
Step 'building saver.html into android-saver/assets'
Push-Location $root
$buildArgs = @((Join-Path $root 'tools\build-saver.js'))
if ($Overlay) { $buildArgs += '--debug' }
& node $buildArgs | Write-Host
$nodeExit = $LASTEXITCODE
Pop-Location
if ($nodeExit -ne 0) { Fail 'tools/build-saver.js' }
if (-not (Test-Path (Join-Path $src 'assets\saver.html'))) { Fail 'assets/saver.html was not produced' }

# ---------------------------------------------------------------- 2. clean
# Only the intermediates: the APKs in android-saver\build are kept, so a debug
# build does not delete the release that was built before it.
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
foreach ($d in @($tmp, (Join-Path $tmp 'gen'), (Join-Path $tmp 'classes'), (Join-Path $tmp 'dex'))) {
    New-Item -ItemType Directory -Force $d | Out-Null
}

# ---------------------------------------------------------------- 3. resources
# The launcher icon is the informer's, copied in at build time rather than
# duplicated in git.
Step 'staging resources'
$res = Join-Path $tmp 'res'
Copy-Item (Join-Path $src 'res') $res -Recurse -Force
$icon = Join-Path $root 'android\res\drawable\ic_launcher.png'
if (-not (Test-Path $icon)) { Fail "missing launcher icon $icon" }
New-Item -ItemType Directory -Force (Join-Path $res 'drawable') | Out-Null
Copy-Item $icon (Join-Path $res 'drawable\ic_launcher.png') -Force

Step 'aapt2 compile'
& $aapt2 compile --dir $res -o (Join-Path $tmp 'res.zip')
if ($LASTEXITCODE -ne 0) { Fail 'aapt2 compile' }

Step 'aapt2 link'
& $aapt2 link `
    -o (Join-Path $tmp 'base.apk') `
    -I $androidJar `
    --manifest (Join-Path $src 'AndroidManifest.xml') `
    -R (Join-Path $tmp 'res.zip') `
    -A (Join-Path $src 'assets') `
    --java (Join-Path $tmp 'gen') `
    --min-sdk-version $MinSdk `
    --target-sdk-version $TargetSdk `
    --version-code $versionCode `
    --version-name $version `
    --rename-manifest-package $AppId `
    --auto-add-overlay
if ($LASTEXITCODE -ne 0) { Fail 'aapt2 link' }

# ---------------------------------------------------------------- 4. java
Step 'javac'
$sources = @()
$sources += (Get-ChildItem (Join-Path $src 'java') -Recurse -Filter *.java | ForEach-Object { $_.FullName })
$sources += (Get-ChildItem (Join-Path $tmp 'gen') -Recurse -Filter *.java | ForEach-Object { $_.FullName })
if (-not $sources) { Fail 'no java sources' }
& $javac -nowarn -encoding UTF-8 -classpath $androidJar -d (Join-Path $tmp 'classes') $sources 2>&1 |
    Where-Object { $_ -notmatch '^Note:|bootstrap class path|deprecat' } | ForEach-Object { Write-Host $_ }
if ($LASTEXITCODE -ne 0) { Fail 'javac' }

Step 'd8'
$classFiles = Get-ChildItem (Join-Path $tmp 'classes') -Recurse -Filter *.class | ForEach-Object { $_.FullName }
& $d8 --lib $androidJar --min-api $MinSdk --output (Join-Path $tmp 'dex') $classFiles
if ($LASTEXITCODE -ne 0) { Fail 'd8' }
if (-not (Test-Path (Join-Path $tmp 'dex\classes.dex'))) { Fail 'no classes.dex produced' }

# ---------------------------------------------------------------- 5. package
Step 'packaging dex into the apk'
Copy-Item (Join-Path $tmp 'base.apk') (Join-Path $tmp 'unsigned.apk') -Force
Push-Location (Join-Path $tmp 'dex')
& $jar uf (Join-Path $tmp 'unsigned.apk') 'classes.dex'
$jarExit = $LASTEXITCODE
Pop-Location
if ($jarExit -ne 0) { Fail 'jar uf' }

Step 'zipalign'
& $zipalign -f -p 4 (Join-Path $tmp 'unsigned.apk') (Join-Path $tmp 'aligned.apk')
if ($LASTEXITCODE -ne 0) { Fail 'zipalign' }

# ---------------------------------------------------------------- 6. sign
# Signed into tmp first and moved into place only once verified, so a wrong
# password or a failed check never leaves an APK where one is expected.
$signed = Join-Path $tmp $apkName
if ($Release) {
    Step "apksigner (release key '$alias')"
    & $apksigner sign --ks $ks --ks-key-alias $alias --ks-pass env:LILI_KS_PASS --key-pass env:LILI_KEY_PASS `
        --min-sdk-version $MinSdk --out $signed (Join-Path $tmp 'aligned.apk')
    if ($LASTEXITCODE -ne 0) { Fail 'apksigner (wrong password or alias?)' }
} else {
    if (-not (Test-Path $ks)) {
        # the same debug key build-apk.ps1 makes, so both apps share one identity
        Step 'creating the local debug keystore (first run only)'
        New-Item -ItemType Directory -Force (Split-Path $ks) | Out-Null
        & $keytool -genkeypair -v -keystore $ks -storepass android -keypass android `
            -alias shelf -keyalg RSA -keysize 2048 -validity 10950 `
            -dname 'CN=PhoneWForecast Debug, OU=shelf, O=home, C=BY' | Out-Null
        if ($LASTEXITCODE -ne 0) { Fail 'keytool' }
    }
    Step 'apksigner (debug key)'
    & $apksigner sign --ks $ks --ks-pass pass:android --key-pass pass:android `
        --min-sdk-version $MinSdk --out $signed (Join-Path $tmp 'aligned.apk')
    if ($LASTEXITCODE -ne 0) { Fail 'apksigner' }
}

& $apksigner verify --min-sdk-version $MinSdk $signed
if ($LASTEXITCODE -ne 0) { Fail 'apksigner verify' }

Move-Item $signed $final -Force
if (Test-Path "$signed.idsig") { Move-Item "$signed.idsig" "$final.idsig" -Force }

$size = [math]::Round((Get-Item $final).Length / 1KB, 1)
Write-Host ""
Write-Host "APK ready: $final  ($size KB)" -ForegroundColor Green

if ($Release) {
    Step 'certificate'
    & $apksigner verify --print-certs --min-sdk-version $MinSdk $final
    $hash = (Get-FileHash $final -Algorithm SHA256).Hash.ToLower()
    Write-Host "SHA-256  $hash  $apkName" -ForegroundColor Green
}

# ---------------------------------------------------------------- 7. install
if ($Install) {
    Step 'adb install'
    $adb = Join-Path $sdk 'platform-tools\adb.exe'
    & $adb install -r $final
    if ($LASTEXITCODE -ne 0) { Fail 'adb install (is the phone connected with USB debugging on? a debug and a release build cannot replace each other)' }
    & $adb shell am start -n "$AppId/com.lili.saver.SetupActivity"
}
