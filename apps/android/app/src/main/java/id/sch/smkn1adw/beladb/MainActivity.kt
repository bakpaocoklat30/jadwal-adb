package id.sch.smkn1adw.beladb

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import id.sch.smkn1adw.beladb.data.ScheduleResolver
import id.sch.smkn1adw.beladb.ui.MainViewModel
import id.sch.smkn1adw.beladb.ui.components.StatusPill
import id.sch.smkn1adw.beladb.ui.screens.*
import id.sch.smkn1adw.beladb.ui.theme.*

private enum class AppTab(val label: String, val icon: ImageVector) {
    DASHBOARD("Beranda", Icons.Default.Home),
    PROFILES("Jadwal", Icons.Default.AccessTime),
    CALENDAR("Kalender", Icons.Default.DateRange),
    AUDIO("Audio", Icons.Default.MusicNote),
    SETTINGS("Pengaturan", Icons.Default.Settings)
}

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            BelSekolahADBTheme {
                BelSekolahRootApp()
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun BelSekolahRootApp(vm: MainViewModel = viewModel()) {
    val state = vm.uiState
    val snackbarHostState = remember { SnackbarHostState() }
    var currentTab by remember { mutableStateOf(AppTab.DASHBOARD) }
    var pendingBackupFileName by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(vm.snackbarMessage) {
        val msg = vm.snackbarMessage ?: return@LaunchedEffect
        snackbarHostState.showSnackbar(msg)
        vm.consumeSnackbar()
    }

    val pickAudioLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenDocument()
    ) { uri ->
        if (uri != null) vm.uploadAudioUri(uri)
    }

    val restoreJsonLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenDocument()
    ) { uri ->
        if (uri != null) vm.restoreScheduleFromUri(uri)
    }

    val exportJsonLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.CreateDocument("application/json")
    ) { uri ->
        if (uri != null) vm.exportScheduleJsonToUri(uri)
    }

    val downloadDbLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.CreateDocument("application/octet-stream")
    ) { uri ->
        val name = pendingBackupFileName
        pendingBackupFileName = null
        if (uri != null && name != null) {
            vm.exportDbBackupToUri(name, uri)
        }
    }

    if (state.initializing) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(SlateBg),
            contentAlignment = Alignment.Center
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                CircularProgressIndicator()
                Spacer(modifier = Modifier.height(12.dp))
                Text("Menghubungkan ke server...", color = SlateMuted)
            }
        }
        return
    }

    val currentUser = state.user
    if (currentUser == null) {
        LoginScreen(
            serverUrl = state.serverUrl,
            isBusy = state.isBusy,
            errorMessage = state.loginError,
            onLogin = { url, user, pass -> vm.login(url, user, pass) }
        )
        return
    }

    val canEditSchedule = currentUser.role == "admin" || currentUser.role == "waka"

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(
                            text = "Bel Sekolah ADB",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold
                        )
                        Text(
                            text = "${currentUser.displayName} • ${currentTab.label}",
                            style = MaterialTheme.typography.labelSmall,
                            color = SlateMuted
                        )
                    }
                },
                actions = {
                    StatusPill(
                        text = if (state.deviceStatus.online) "PC Online" else "PC Offline",
                        containerColor = if (state.deviceStatus.online) EmeraldContainer else RedContainer,
                        contentColor = if (state.deviceStatus.online) EmeraldAccent else RedDanger
                    )
                    IconButton(onClick = { vm.refreshAll() }, enabled = !state.isRefreshing) {
                        if (state.isRefreshing) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(18.dp),
                                strokeWidth = 2.dp
                            )
                        } else {
                            Icon(Icons.Default.Refresh, contentDescription = "Refresh")
                        }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = SlateCard
                )
            )
        },
        bottomBar = {
            NavigationBar(containerColor = SlateCard) {
                AppTab.entries.forEach { tab ->
                    NavigationBarItem(
                        selected = currentTab == tab,
                        onClick = { currentTab = tab },
                        icon = { Icon(tab.icon, contentDescription = tab.label) },
                        label = { Text(tab.label) }
                    )
                }
            }
        }
    ) { innerPadding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
        ) {
            when (currentTab) {
                AppTab.DASHBOARD -> DashboardScreen(
                    state = state,
                    onPlayManual = { label, steps -> vm.playManual(label, steps) },
                    onStopAudio = { vm.stopBellAudio() },
                    onSyncNow = { vm.syncBellNow() },
                    onRemoteShutdown = { action, grace, reason -> vm.remoteShutdown(action, grace, reason) },
                    onCancelShutdown = { vm.cancelShutdown() },
                    onApplyTodayOverride = { profileId, note -> vm.applyTodayOverride(profileId, note) },
                    onRemoveOverride = { id -> vm.removeOverride(id) }
                )

                AppTab.PROFILES -> ProfilesScreen(
                    state = state,
                    canEdit = canEditSchedule,
                    onSaveProfile = { existingId, req -> vm.saveProfile(existingId, req) },
                    onDuplicateProfile = { id -> vm.duplicateProfile(id) },
                    onShiftProfile = { id, delta -> vm.shiftProfile(id, delta) },
                    onDeleteProfile = { id -> vm.deleteProfile(id) },
                    onPlaySlot = { label, steps -> vm.playManual(label, steps) },
                    onGeneratePreview = { startTime, count, dur, intro, introDelay, pattern, endLabel, endFile, breaks, onGen ->
                        vm.generateSlots(
                            startTime,
                            count,
                            dur,
                            intro,
                            introDelay,
                            pattern,
                            endLabel,
                            endFile,
                            breaks,
                            onGen
                        )
                    }
                )

                AppTab.CALENDAR -> CalendarScreen(
                    state = state,
                    canEdit = canEditSchedule,
                    onSaveWeeklyRules = { rules -> vm.saveWeeklyRules(rules) },
                    onCreateOverride = { start, end, profileId, note ->
                        vm.createOverride(start, end, profileId, note)
                    },
                    onDeleteOverride = { id -> vm.removeOverride(id) }
                )

                AppTab.AUDIO -> AudioScreen(
                    state = state,
                    canDeleteServerAudio = canEditSchedule,
                    onPickUploadAudio = {
                        pickAudioLauncher.launch(arrayOf("audio/*"))
                    },
                    onPlayAtBell = { fileName, label -> vm.playSingleFileAtBell(fileName, label) },
                    onStopBellAudio = { vm.stopBellAudio() },
                    onPreviewInPhone = { fileName -> vm.playPhoneAudioPreview(fileName) },
                    onStopPhonePreview = { vm.stopPhoneAudio() },
                    onDeleteServerAudio = { fileName -> vm.deleteServerAudio(fileName) }
                )

                AppTab.SETTINGS -> SettingsScreen(
                    state = state,
                    onSaveShutdownSettings = { enabled, grace, dayRules ->
                        vm.saveShutdownSettings(enabled, grace, dayRules)
                    },
                    onChangePassword = { cur, next, done -> vm.changePassword(cur, next, done) },
                    onLogout = { vm.logout() },
                    onExportScheduleJson = {
                        val today = ScheduleResolver.getZonedTodayParts(
                            state.snapshot?.timeZone ?: "Asia/Jakarta"
                        ).first
                        exportJsonLauncher.launch("jadwal-adb-$today.json")
                    },
                    onRestoreScheduleJson = {
                        restoreJsonLauncher.launch(arrayOf("application/json", "text/plain", "*/*"))
                    },
                    onSaveBackupSettings = { enabled, time, retain ->
                        vm.saveBackupSettings(enabled, time, retain)
                    },
                    onCreateBackupNow = { vm.createBackupNow() },
                    onDownloadBackupDb = { fileName ->
                        pendingBackupFileName = fileName
                        downloadDbLauncher.launch(fileName)
                    },
                    onDeleteBackupDb = { fileName -> vm.deleteBackup(fileName) },
                    onCreateUser = { u, d, r, p, done -> vm.createUser(u, d, r, p, done) },
                    onUpdateUser = { id, d, r, a, p -> vm.updateUser(id, d, r, a, p) },
                    onDeleteUser = { id -> vm.deleteUser(id) },
                    onRotateDeviceToken = { vm.rotateDeviceToken() }
                )
            }
        }
    }
}
