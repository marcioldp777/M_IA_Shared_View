# Instala o Virtual Display Driver (VirtualDrivers, MIT, assinado pela SignPath Foundation) para o modo "TV como 2º monitor".
# Executar com permissão de administrador:  powershell -ExecutionPolicy Bypass -File install.ps1 -DriverDir <pasta com MttVDD.inf>
# Saída: código 0 = instalado; 1 = erro (mensagem na saída de erro).
[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$DriverDir)
$ErrorActionPreference = 'Stop'
$HardwareId = 'Root\MttVDD'
$SettingsDir = 'C:\VirtualDisplayDriver'   # o driver lê a configuração daqui

try {
  $inf = Join-Path $DriverDir 'MttVDD.inf'
  if (-not (Test-Path $inf)) { throw "MttVDD.inf não encontrado em $DriverDir" }

  # Configuração: só 1920x1080 a 60 Hz e nenhum monitor ligado (o app liga pelo pipe quando o usuário pedir).
  New-Item -ItemType Directory -Force -Path $SettingsDir | Out-Null
  @'
<?xml version='1.0' encoding='utf-8'?>
<vdd_settings>
    <monitors><count>0</count></monitors>
    <gpu><friendlyname>default</friendlyname></gpu>
    <global><g_refresh_rate>60</g_refresh_rate></global>
    <resolutions><resolution><width>1920</width><height>1080</height><refresh_rate>60</refresh_rate></resolution></resolutions>
    <options>
        <CustomEdid>false</CustomEdid><PreventSpoof>false</PreventSpoof><EdidCeaOverride>false</EdidCeaOverride>
        <HardwareCursor>true</HardwareCursor><SDR10bit>false</SDR10bit><HDRPlus>false</HDRPlus>
        <logging>false</logging><debuglogging>false</debuglogging>
    </options>
</vdd_settings>
'@ | Set-Content -Encoding UTF8 -Path (Join-Path $SettingsDir 'vdd_settings.xml')

  # Já existe o dispositivo? Só atualiza o driver.
  $existing = Get-PnpDevice -ErrorAction SilentlyContinue | Where-Object { $_.HardwareID -contains $HardwareId }

  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class VddSetup {
  [StructLayout(LayoutKind.Sequential)] public struct SP_DEVINFO_DATA { public int cbSize; public Guid ClassGuid; public int DevInst; public IntPtr Reserved; }
  [DllImport("setupapi.dll", SetLastError = true)] static extern IntPtr SetupDiCreateDeviceInfoList(ref Guid ClassGuid, IntPtr hwndParent);
  [DllImport("setupapi.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool SetupDiCreateDeviceInfoW(IntPtr set, string name, ref Guid cls, string desc, IntPtr hwnd, int flags, ref SP_DEVINFO_DATA data);
  [DllImport("setupapi.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool SetupDiSetDeviceRegistryPropertyW(IntPtr set, ref SP_DEVINFO_DATA data, int prop, byte[] buf, int size);
  [DllImport("setupapi.dll", SetLastError = true)] static extern bool SetupDiCallClassInstaller(int fn, IntPtr set, ref SP_DEVINFO_DATA data);
  [DllImport("setupapi.dll", SetLastError = true)] static extern bool SetupDiDestroyDeviceInfoList(IntPtr set);
  [DllImport("newdev.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool UpdateDriverForPlugAndPlayDevicesW(IntPtr hwnd, string hwid, string inf, int flags, out bool reboot);
  const int SPDRP_HARDWAREID = 1, DICD_GENERATE_ID = 1, DIF_REGISTERDEVICE = 0x19, INSTALLFLAG_FORCE = 1;
  public static void Create(string hwid) {
    Guid display = new Guid("4D36E968-E325-11CE-BFC1-08002BE10318");
    IntPtr set = SetupDiCreateDeviceInfoList(ref display, IntPtr.Zero);
    if (set == new IntPtr(-1)) throw new System.ComponentModel.Win32Exception();
    try {
      SP_DEVINFO_DATA data = new SP_DEVINFO_DATA(); data.cbSize = Marshal.SizeOf(data);
      if (!SetupDiCreateDeviceInfoW(set, "Display", ref display, null, IntPtr.Zero, DICD_GENERATE_ID, ref data)) throw new System.ComponentModel.Win32Exception();
      byte[] ids = System.Text.Encoding.Unicode.GetBytes(hwid + "\0\0");
      if (!SetupDiSetDeviceRegistryPropertyW(set, ref data, SPDRP_HARDWAREID, ids, ids.Length)) throw new System.ComponentModel.Win32Exception();
      if (!SetupDiCallClassInstaller(DIF_REGISTERDEVICE, set, ref data)) throw new System.ComponentModel.Win32Exception();
    } finally { SetupDiDestroyDeviceInfoList(set); }
  }
  public static bool Install(string hwid, string inf) {
    bool reboot;
    if (!UpdateDriverForPlugAndPlayDevicesW(IntPtr.Zero, hwid, inf, INSTALLFLAG_FORCE, out reboot)) throw new System.ComponentModel.Win32Exception();
    return reboot;
  }
}
'@

  if (-not $existing) { [VddSetup]::Create($HardwareId) }
  $reboot = [VddSetup]::Install($HardwareId, (Resolve-Path $inf).Path)
  Write-Output ("OK" + $(if ($reboot) { ' REBOOT' } else { '' }))
  exit 0
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
