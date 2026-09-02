# Builds the APK with nothing but the Android SDK build-tools and a JDK.
#
#   powershell -ExecutionPolicy Bypass -File tools\build-apk.ps1
#   powershell -ExecutionPolicy Bypass -File tools\build-apk.ps1 -Install
#
# No Gradle, no Kotlin, no AndroidX, nothing downloaded. The app is one Activity
# hosting the same informer.html the browser runs, so this stays a wrapper.

param(
    [switch]$Install,          # adb install -r when done
    [switch]$Overlay,          # bake in the on-screen fps/state overlay
    [switch]$Test,             # bake in the tap-to-play episode menu
    [switch]$Random,           # let episodes fire on their own schedule
    [switch]$PlanDemo,         # 3 animations in the next 5 min, to check the scheduler
    [switch]$NoCat,            # forecast only, for measuring the cat's cost
    [switch]$NoAlive,          # cat on screen but not breathing, for baselines
    [int]$MinSdk = 21,         # Android 5.0 - safe even if the G4 Plus never took Nougat
    [int]$TargetSdk = 34
)

# Native tools write notes and warnings to stderr; with 'Stop' PowerShell turns
# those into terminating errors. Every external call below checks $LASTEXITCODE
# explicitly instead.
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$android = Join-Path $root 'android'
$out = Join-Path $android 'build'

function Fail($m) { Write-Host "FAILED: $m" -ForegroundColor Red; exit 1 }
function Step($m) { Write-Host "-> $m" -ForegroundColor Cyan }

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
Write-Host "build-tools $($bt.Name)   platform $($platform.Name)   jdk $(Split-Path -Leaf $jdk)" -ForegroundColor DarkGray

# ---------------------------------------------------------------- 1. the page
Step 'building informer.html into android/assets'
Push-Location $root
$buildArgs = @((Join-Path $root 'tools\build.js'))
if ($Overlay) { $buildArgs += '--debug' }
if ($Test)    { $buildArgs += '--test' }
if ($Random)  { $buildArgs += '--random' }
if ($PlanDemo) { $buildArgs += '--plandemo' }
if ($NoCat)    { $buildArgs += '--nocat' }
if ($NoAlive)  { $buildArgs += '--noalive' }
& node $buildArgs | Write-Host
Pop-Location
if (-not (Test-Path (Join-Path $android 'assets\informer.html'))) { Fail 'assets/informer.html was not produced' }

# ---------------------------------------------------------------- 2. clean
if (Test-Path $out) { Remove-Item $out -Recurse -Force }
New-Item -ItemType Directory -Force $out | Out-Null
New-Item -ItemType Directory -Force (Join-Path $out 'gen') | Out-Null
New-Item -ItemType Directory -Force (Join-Path $out 'classes') | Out-Null
New-Item -ItemType Directory -Force (Join-Path $out 'dex') | Out-Null

# ---------------------------------------------------------------- 3. resources
Step 'aapt2 compile'
& $aapt2 compile --dir (Join-Path $android 'res') -o (Join-Path $out 'res.zip')
if ($LASTEXITCODE -ne 0) { Fail 'aapt2 compile' }

Step 'aapt2 link'
& $aapt2 link `
    -o (Join-Path $out 'base.apk') `
    -I $androidJar `
    --manifest (Join-Path $android 'AndroidManifest.xml') `
    -R (Join-Path $out 'res.zip') `
    -A (Join-Path $android 'assets') `
    --java (Join-Path $out 'gen') `
    --min-sdk-version $MinSdk `
    --target-sdk-version $TargetSdk `
    --auto-add-overlay
if ($LASTEXITCODE -ne 0) { Fail 'aapt2 link' }

# ---------------------------------------------------------------- 4. java
Step 'javac'
$sources = @()
$sources += (Get-ChildItem (Join-Path $android 'java') -Recurse -Filter *.java | ForEach-Object { $_.FullName })
$sources += (Get-ChildItem (Join-Path $out 'gen') -Recurse -Filter *.java | ForEach-Object { $_.FullName })
if (-not $sources) { Fail 'no java sources' }
& $javac -nowarn -encoding UTF-8 -classpath $androidJar -d (Join-Path $out 'classes') $sources 2>&1 |
    Where-Object { $_ -notmatch '^Note:|bootstrap class path|deprecat' } | ForEach-Object { Write-Host $_ }
if ($LASTEXITCODE -ne 0) { Fail 'javac' }

Step 'd8'
$classFiles = Get-ChildItem (Join-Path $out 'classes') -Recurse -Filter *.class | ForEach-Object { $_.FullName }
& $d8 --lib $androidJar --min-api $MinSdk --output (Join-Path $out 'dex') $classFiles
if ($LASTEXITCODE -ne 0) { Fail 'd8' }
if (-not (Test-Path (Join-Path $out 'dex\classes.dex'))) { Fail 'no classes.dex produced' }

# ---------------------------------------------------------------- 5. package
Step 'packaging dex into the apk'
Copy-Item (Join-Path $out 'base.apk') (Join-Path $out 'unsigned.apk') -Force
Push-Location (Join-Path $out 'dex')
& $jar uf (Join-Path $out 'unsigned.apk') 'classes.dex'
Pop-Location
if ($LASTEXITCODE -ne 0) { Fail 'jar uf' }

Step 'zipalign'
& $zipalign -f -p 4 (Join-Path $out 'unsigned.apk') (Join-Path $out 'aligned.apk')
if ($LASTEXITCODE -ne 0) { Fail 'zipalign' }

# ---------------------------------------------------------------- 6. sign
$ks = Join-Path $android 'keystore\debug.keystore'
if (-not (Test-Path $ks)) {
    Step 'creating a local debug keystore (first run only)'
    New-Item -ItemType Directory -Force (Split-Path $ks) | Out-Null
    & $keytool -genkeypair -v -keystore $ks -storepass android -keypass android `
        -alias shelf -keyalg RSA -keysize 2048 -validity 10950 `
        -dname 'CN=PhoneWForecast Debug, OU=shelf, O=home, C=BY' | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail 'keytool' }
}

Step 'apksigner'
$final = Join-Path $out 'phone-forecast.apk'
& $apksigner sign --ks $ks --ks-pass pass:android --key-pass pass:android `
    --min-sdk-version $MinSdk --out $final (Join-Path $out 'aligned.apk')
if ($LASTEXITCODE -ne 0) { Fail 'apksigner' }

& $apksigner verify --min-sdk-version $MinSdk $final
if ($LASTEXITCODE -ne 0) { Fail 'apksigner verify' }

$size = [math]::Round((Get-Item $final).Length / 1KB, 1)
Write-Host ""
Write-Host "APK ready: $final  ($size KB)" -ForegroundColor Green

# ---------------------------------------------------------------- 7. install
if ($Install) {
    Step 'adb install'
    $adb = Join-Path $sdk 'platform-tools\adb.exe'
    & $adb install -r $final
    if ($LASTEXITCODE -ne 0) { Fail 'adb install (is the phone connected with USB debugging on?)' }
    & $adb shell am start -n 'com.lili.informer/.MainActivity'
}

