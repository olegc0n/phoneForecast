# Builds Lili Weather with nothing but the Android SDK build-tools and a JDK.
#
#   powershell -ExecutionPolicy Bypass -File tools\build-apk.ps1             debug APK
#   powershell -ExecutionPolicy Bypass -File tools\build-apk.ps1 -Install    and adb install it
#   powershell -ExecutionPolicy Bypass -File tools\build-apk.ps1 -Release    signed for publishing
#
# No Gradle, no Kotlin, no AndroidX, nothing downloaded. The app is one Activity
# hosting the same informer.html the browser runs, so this stays a wrapper.
#
# Output: android\build\lili-weather-<version>.apk (release) or
#         android\build\lili-weather-<version>-debug.apk
# The version is android\VERSION (major.minor.patch); the manifest has none.
#
# -Release signs with .local\release.keystore (gitignored), alias from
# $env:LILI_KEY_ALIAS (default 'lili'), passwords from $env:LILI_KS_PASS and
# $env:LILI_KEY_PASS - handed to apksigner by name, so they never appear on a
# command line or in this output. It never creates the keystore: if anything is
# missing it stops before building and says what to do.

param(
    [switch]$Install,          # adb install -r when done, then open the app
    [switch]$Overlay,          # bake in the on-screen fps/state overlay (debug only)
    [switch]$Release,          # sign with the release keystore
    [switch]$Test,             # bake in the tap-to-play episode menu
    [switch]$Random,           # let episodes fire on their own schedule
    [switch]$PlanDemo,         # 3 animations in the next 5 min, to check the scheduler
    [switch]$NoCat,            # forecast only, for measuring the cat's cost
    [switch]$NoAlive,          # cat on screen but not moving, for baselines
    [int]$MinSdk = 21,         # Android 5.0 - safe even if the G4 Plus never took Nougat
    [int]$TargetSdk = 34
)

# ---------------------------------------------------------------- identity
# THE APPLICATION ID, in one place. It is what Android and every installed copy
# know the app by, so it is permanent once an APK is public. It differs from the
# keyed build on main (com.lili.informer), so both can be installed at once. The
# manifest's `package` (the Java namespace) must be the same; checked below.
$AppId = 'com.lili.weather'

# Native tools write notes and warnings to stderr; with 'Stop' PowerShell turns
# those into terminating errors. Every external call below checks $LASTEXITCODE.
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$android = Join-Path $root 'android'
$outDir = Join-Path $android 'build'
$tmp = Join-Path $outDir 'tmp'

function Fail($m) { Write-Host "FAILED: $m" -ForegroundColor Red; exit 1 }
function Step($m) { Write-Host "-> $m" -ForegroundColor Cyan }

# SHA-256 with .NET itself: Get-FileHash is missing when this script is started
# from Git Bash (its module path is not set up there), and this works anywhere.
function Sha256($file) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $stream = [System.IO.File]::OpenRead($file)
    try { $bytes = $sha.ComputeHash($stream) } finally { $stream.Dispose(); $sha.Dispose() }
    return -join ($bytes | ForEach-Object { $_.ToString('x2') })
}

# ---------------------------------------------------------------- version
$versionFile = Join-Path $android 'VERSION'
if (-not (Test-Path $versionFile)) { Fail "missing $versionFile" }
$version = (Get-Content $versionFile -Raw).Trim()
if ($version -notmatch '^(\d+)\.(\d+)\.(\d+)$') { Fail "VERSION must be major.minor.patch, not '$version'" }
$versionCode = [int]$Matches[1] * 10000 + [int]$Matches[2] * 100 + [int]$Matches[3]
if ($Release) { $apkName = "lili-weather-$version.apk" } else { $apkName = "lili-weather-$version-debug.apk" }
$final = Join-Path $outDir $apkName

$manifest = Join-Path $android 'AndroidManifest.xml'
$manifestText = Get-Content $manifest -Raw
if ($manifestText -notmatch 'package="([^"]+)"') { Fail "no package in $manifest" }
if ($Matches[1] -ne $AppId) { Fail "the manifest's package is $($Matches[1]), the app id is $AppId - they must agree" }
if ($manifestText -match 'android:version(Code|Name)') { Fail "the manifest must not carry a version: aapt2 only fills in one that is absent (android\VERSION is the version)" }

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
# runtime permissions (23) must compile; each newer call is guarded by SDK_INT
$platformApi = 0
if ($platform.Name -match '^android-(\d+)') { $platformApi = [int]$Matches[1] }
if ($platformApi -lt 23) { Fail "platform $($platform.Name) is below API 23; install a newer platform (requestPermissions)" }

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
    if ($Overlay -or $Test -or $PlanDemo -or $NoCat -or $NoAlive) {
        Fail '-Release does not mix with -Overlay, -Test, -PlanDemo, -NoCat or -NoAlive: those are for debugging.'
    }
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
        Write-Host 'Lili Weather is signed with the same release key as Lili Wallpaper. It is the'
        Write-Host 'apps'' identity: every update must be signed with it, and this script never'
        Write-Host 'makes a new one. Put the existing keystore at:'
        Write-Host ''
        Write-Host "  $ks" -ForegroundColor Yellow
        Write-Host ''
        Write-Host 'and, in the same PowerShell window (Read-Host keeps the password out of the history):'
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
    $ks = Join-Path $android 'keystore\debug.keystore'
}

Write-Host "Lili Weather $version (code $versionCode)  id $AppId  $(if ($Release) {'RELEASE'} else {'debug'})" -ForegroundColor White
Write-Host "build-tools $($bt.Name)   platform $($platform.Name)   jdk $(Split-Path -Leaf $jdk)" -ForegroundColor DarkGray

# ---------------------------------------------------------------- 1. the page
Step 'building informer.html into android/assets'
Push-Location $root
$buildArgs = @((Join-Path $root 'tools\build.js'))
if ($Overlay)  { $buildArgs += '--debug' }
if ($Test)     { $buildArgs += '--test' }
if ($Random)   { $buildArgs += '--random' }
if ($PlanDemo) { $buildArgs += '--plandemo' }
if ($NoCat)    { $buildArgs += '--nocat' }
if ($NoAlive)  { $buildArgs += '--noalive' }
& node $buildArgs | Write-Host
$nodeExit = $LASTEXITCODE
Pop-Location
if ($nodeExit -ne 0) { Fail 'tools/build.js (see above - nothing was written)' }
if (-not (Test-Path (Join-Path $android 'assets\informer.html'))) { Fail 'assets/informer.html was not produced' }

# ---------------------------------------------------------------- 2. clean
# Only the intermediates: the APKs in android\build are kept, so a debug build
# does not delete the release that was built before it.
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
foreach ($d in @($tmp, (Join-Path $tmp 'gen'), (Join-Path $tmp 'classes'), (Join-Path $tmp 'dex'))) {
    New-Item -ItemType Directory -Force $d | Out-Null
}

# ---------------------------------------------------------------- 3. resources
Step 'aapt2 compile'
& $aapt2 compile --dir (Join-Path $android 'res') -o (Join-Path $tmp 'res.zip')
if ($LASTEXITCODE -ne 0) { Fail 'aapt2 compile' }

Step 'aapt2 link'
# A debug build is debuggable, so `adb shell run-as` can look at its files.
$debugFlags = @()
if (-not $Release) { $debugFlags += '--debug-mode' }
& $aapt2 link `
    -o (Join-Path $tmp 'base.apk') `
    -I $androidJar `
    --manifest $manifest `
    -R (Join-Path $tmp 'res.zip') `
    -A (Join-Path $android 'assets') `
    --java (Join-Path $tmp 'gen') `
    --min-sdk-version $MinSdk `
    --target-sdk-version $TargetSdk `
    --version-code $versionCode `
    --version-name $version `
    --auto-add-overlay `
    @debugFlags
if ($LASTEXITCODE -ne 0) { Fail 'aapt2 link' }

# ---------------------------------------------------------------- 4. java
Step 'javac'
$sources = @()
$sources += (Get-ChildItem (Join-Path $android 'java') -Recurse -Filter *.java | ForEach-Object { $_.FullName })
$sources += (Get-ChildItem (Join-Path $tmp 'gen') -Recurse -Filter *.java | ForEach-Object { $_.FullName })
if (-not $sources) { Fail 'no java sources' }
& $javac -nowarn -encoding UTF-8 -classpath $androidJar -d (Join-Path $tmp 'classes') $sources 2>&1 |
    Where-Object { $_ -notmatch '^Note:|bootstrap class path|deprecat' } | ForEach-Object { Write-Host $_ }
if ($LASTEXITCODE -ne 0) { Fail 'javac' }

Step 'd8'
# One jar in, not every .class path on the command line: the anonymous classes
# make that list long, and d8 is a .bat with cmd.exe's 8191-character limit.
$classesJar = Join-Path $tmp 'classes.jar'
& $jar cf $classesJar -C (Join-Path $tmp 'classes') .
if ($LASTEXITCODE -ne 0) { Fail 'jar cf (classes)' }
& $d8 --lib $androidJar --min-api $MinSdk --output (Join-Path $tmp 'dex') $classesJar
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
    # The debug keystore is a private key and not in git. A new one means a new
    # signature, so `adb install -r` refuses to update an app signed by the old
    # one and the phone has to uninstall first - which loses localStorage: the
    # chosen city, the weather cache and the day's plan.
    if (-not (Test-Path $ks)) {
        Step 'creating a local debug keystore (first run only)'
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
$hash = Sha256 $final
Write-Host ""
Write-Host "APK ready: $final  ($size KB)" -ForegroundColor Green
Write-Host "SHA-256  $hash  $apkName" -ForegroundColor Green

if ($Release) {
    Step 'certificate'
    & $apksigner verify --print-certs --min-sdk-version $MinSdk $final
}

# ---------------------------------------------------------------- 7. install
if ($Install) {
    Step 'adb install'
    $adb = Join-Path $sdk 'platform-tools\adb.exe'
    & $adb install -r $final
    if ($LASTEXITCODE -ne 0) { Fail 'adb install (is the phone connected with USB debugging on? a debug and a release build cannot replace each other)' }
    & $adb shell am start -n "$AppId/.MainActivity"
}
