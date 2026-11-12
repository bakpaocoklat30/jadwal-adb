package id.sch.smkn1adw.beladb.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import id.sch.smkn1adw.beladb.data.*
import id.sch.smkn1adw.beladb.ui.MainUiState
import id.sch.smkn1adw.beladb.ui.components.SectionCard
import id.sch.smkn1adw.beladb.ui.components.StatusPill
import id.sch.smkn1adw.beladb.ui.components.roleDisplayName
import id.sch.smkn1adw.beladb.ui.theme.*

@Composable
fun SettingsScreen(
    state: MainUiState,
    onSaveShutdownSettings: (enabled: Boolean, graceSeconds: Int, dayRules: List<ShutdownDayRule>) -> Unit,
    onChangePassword: (currentPassword: String, newPassword: String, onDone: () -> Unit) -> Unit,
    onLogout: () -> Unit,
    onExportScheduleJson: () -> Unit,
    onRestoreScheduleJson: () -> Unit,
    onSaveBackupSettings: (enabled: Boolean, time: String, retainCount: Int) -> Unit,
    onCreateBackupNow: () -> Unit,
    onDownloadBackupDb: (fileName: String) -> Unit,
    onDeleteBackupDb: (fileName: String) -> Unit,
    onCreateUser: (username: String, displayName: String, role: String, password: String, onDone: () -> Unit) -> Unit,
    onUpdateUser: (id: String, displayName: String?, role: String?, active: Boolean?, password: String?) -> Unit,
    onDeleteUser: (id: String) -> Unit,
    onRotateDeviceToken: () -> Unit
) {
    val user = state.user ?: return
    val isAdmin = user.role == "admin"
    val canManageSchedule = user.role == "admin" || user.role == "waka"
    val clipboard = LocalClipboardManager.current

    // Auto-shutdown draft
    val currentShutdown = state.snapshot?.shutdownSettings ?: ShutdownSettings()
    var shutdownEnabled by remember(currentShutdown) { mutableStateOf(currentShutdown.enabled) }
    var shutdownGrace by remember(currentShutdown) { mutableStateOf(currentShutdown.graceSeconds.toString()) }
    var shutdownDayRules by remember(currentShutdown) {
        val base = currentShutdown.dayRules.ifEmpty { defaultShutdownDayRules() }
        mutableStateOf((0..6).map { day ->
            base.firstOrNull { it.dayOfWeek == day } ?: ShutdownDayRule(day, day in 1..5, "16:30")
        })
    }

    // Auto-backup draft (Admin)
    val bs = state.backupSettings
    var backupEnabled by remember(bs) { mutableStateOf(bs?.enabled ?: true) }
    var backupTime by remember(bs) { mutableStateOf(bs?.time ?: "02:00") }
    var backupRetain by remember(bs) { mutableStateOf((bs?.retainCount ?: 14).toString()) }

    var showChangePasswordDialog by remember { mutableStateOf(false) }
    var showCreateUserDialog by remember { mutableStateOf(false) }
    var editingUser by remember { mutableStateOf<UserPublic?>(null) }

    val orderedDays = listOf(1, 2, 3, 4, 5, 6, 0)
    val timeRegex = Regex("^([01]\\d|2[0-3]):([0-5]\\d)$")

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .background(SlateBg),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        // Account & Server Section
        item {
            SectionCard(
                title = "Akun & Koneksi Server",
                subtitle = "Server aktif: ${state.serverUrl}"
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(user.displayName, fontWeight = FontWeight.Bold)
                        Text("@${user.username}", style = MaterialTheme.typography.bodySmall, color = SlateMuted)
                    }
                    StatusPill(
                        text = roleDisplayName(user.role),
                        containerColor = NavyContainer,
                        contentColor = NavyPrimary
                    )
                }

                Spacer(modifier = Modifier.height(12.dp))

                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(
                        onClick = { showChangePasswordDialog = true },
                        modifier = Modifier.weight(1f)
                    ) {
                        Icon(Icons.Default.Lock, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(modifier = Modifier.width(6.dp))
                        Text("Ubah Password")
                    }
                    Button(
                        onClick = onLogout,
                        colors = ButtonDefaults.buttonColors(containerColor = RedDanger),
                        modifier = Modifier.weight(1f)
                    ) {
                        Icon(Icons.Default.ExitToApp, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(modifier = Modifier.width(6.dp))
                        Text("Keluar")
                    }
                }
            }
        }

        // Auto-Shutdown Per Day (Admin & Waka)
        if (canManageSchedule) {
            item {
                val allTimesValid = shutdownDayRules.all { timeRegex.matches(it.time.trim()) }
                SectionCard(
                    title = "Auto-Shutdown PC Bel per Hari",
                    subtitle = "Jadwalkan mati otomatis berbeda untuk Senin–Minggu",
                    trailing = {
                        Button(
                            onClick = {
                                val grace = (shutdownGrace.toIntOrNull() ?: 20).coerceIn(5, 120)
                                onSaveShutdownSettings(shutdownEnabled, grace, shutdownDayRules)
                            },
                            enabled = !state.isBusy && allTimesValid
                        ) {
                            Text("Simpan")
                        }
                    }
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text("Aktifkan Auto-Shutdown", fontWeight = FontWeight.Medium)
                        Switch(checked = shutdownEnabled, onCheckedChange = { shutdownEnabled = it })
                    }

                    OutlinedTextField(
                        value = shutdownGrace,
                        onValueChange = { shutdownGrace = it.filter { ch -> ch.isDigit() } },
                        label = { Text("Jeda Peringatan (5–120 detik)") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )

                    Spacer(modifier = Modifier.height(10.dp))

                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        orderedDays.forEach { day ->
                            val rule = shutdownDayRules.first { it.dayOfWeek == day }
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                Switch(
                                    checked = rule.enabled,
                                    onCheckedChange = { checked ->
                                        shutdownDayRules = shutdownDayRules.map {
                                            if (it.dayOfWeek == day) it.copy(enabled = checked) else it
                                        }
                                    }
                                )
                                Text(
                                    text = DAY_NAMES_ID[day],
                                    modifier = Modifier.width(72.dp),
                                    fontWeight = FontWeight.Medium
                                )
                                OutlinedTextField(
                                    value = rule.time,
                                    onValueChange = { v ->
                                        shutdownDayRules = shutdownDayRules.map {
                                            if (it.dayOfWeek == day) it.copy(time = v) else it
                                        }
                                    },
                                    enabled = rule.enabled,
                                    isError = !timeRegex.matches(rule.time.trim()),
                                    singleLine = true,
                                    label = { Text("HH:MM") },
                                    modifier = Modifier.weight(1f)
                                )
                            }
                        }
                    }
                }
            }
        }

        // Schedule JSON Export & Restore (Admin & Waka)
        if (canManageSchedule) {
            item {
                SectionCard(
                    title = "Backup & Restore Jadwal (.json)",
                    subtitle = "Ekspor jadwal sekolah atau pulihkan dari file JSON"
                ) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(
                            onClick = onExportScheduleJson,
                            enabled = !state.isBusy,
                            modifier = Modifier.weight(1f)
                        ) {
                            Icon(Icons.Default.CloudDownload, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(modifier = Modifier.width(6.dp))
                            Text("Export JSON")
                        }
                        Button(
                            onClick = onRestoreScheduleJson,
                            enabled = !state.isBusy,
                            modifier = Modifier.weight(1f)
                        ) {
                            Icon(Icons.Default.Restore, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(modifier = Modifier.width(6.dp))
                            Text("Restore JSON")
                        }
                    }
                }
            }
        }

        // Admin-only DB Backups
        if (isAdmin) {
            item {
                val backupTimeValid = timeRegex.matches(backupTime.trim())
                SectionCard(
                    title = "Backup Database Server (.db)",
                    subtitle = "Snapshot otomatis harian SQLite di server VPS",
                    trailing = {
                        FilledTonalButton(
                            onClick = onCreateBackupNow,
                            enabled = !state.isBusy
                        ) {
                            Text("Backup Sekarang")
                        }
                    }
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text("Backup Otomatis Harian")
                        Switch(checked = backupEnabled, onCheckedChange = { backupEnabled = it })
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(
                            value = backupTime,
                            onValueChange = { backupTime = it },
                            label = { Text("Jam (HH:MM)") },
                            isError = !backupTimeValid,
                            singleLine = true,
                            modifier = Modifier.weight(1f)
                        )
                        OutlinedTextField(
                            value = backupRetain,
                            onValueChange = { backupRetain = it.filter { ch -> ch.isDigit() } },
                            label = { Text("Simpan Maks (file)") },
                            singleLine = true,
                            modifier = Modifier.weight(1f)
                        )
                    }
                    Spacer(modifier = Modifier.height(8.dp))
                    Button(
                        onClick = {
                            val retain = (backupRetain.toIntOrNull() ?: 14).coerceIn(1, 90)
                            onSaveBackupSettings(backupEnabled, backupTime.trim(), retain)
                        },
                        enabled = !state.isBusy && backupTimeValid
                    ) {
                        Text("Simpan Pengaturan Auto-Backup")
                    }

                    if (state.backupFiles.isNotEmpty()) {
                        Spacer(modifier = Modifier.height(12.dp))
                        HorizontalDivider()
                        Spacer(modifier = Modifier.height(8.dp))
                        Text("Daftar File Backup (.db):", fontWeight = FontWeight.SemiBold)
                        Spacer(modifier = Modifier.height(6.dp))
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            state.backupFiles.forEach { file ->
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text(file.fileName, fontWeight = FontWeight.Medium)
                                        Text(
                                            text = "${formatBytes(file.sizeBytes)} • ${file.kind} • ${formatShortTime(file.createdAt)}",
                                            style = MaterialTheme.typography.bodySmall,
                                            color = SlateMuted
                                        )
                                    }
                                    IconButton(onClick = { onDownloadBackupDb(file.fileName) }) {
                                        Icon(Icons.Default.CloudDownload, contentDescription = "Unduh", tint = NavyPrimary)
                                    }
                                    IconButton(onClick = { onDeleteBackupDb(file.fileName) }) {
                                        Icon(Icons.Default.Delete, contentDescription = "Hapus", tint = RedDanger)
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // Admin-only Device Token & User Management
            item {
                SectionCard(
                    title = "Token PC Bel (Device Token)",
                    subtitle = "Digunakan aplikasi Desktop PC Bel untuk menyambung ke server"
                ) {
                    val tokenText = state.deviceToken ?: "(Memuat...)"
                    Surface(
                        color = SlateBg,
                        shape = RoundedCornerShape(10.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text(
                            text = tokenText,
                            style = MaterialTheme.typography.bodySmall,
                            modifier = Modifier.padding(12.dp)
                        )
                    }
                    Spacer(modifier = Modifier.height(8.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(
                            onClick = {
                                state.deviceToken?.let {
                                    clipboard.setText(AnnotatedString(it))
                                }
                            },
                            enabled = state.deviceToken != null,
                            modifier = Modifier.weight(1f)
                        ) {
                            Icon(Icons.Default.ContentCopy, contentDescription = null, modifier = Modifier.size(16.dp))
                            Spacer(modifier = Modifier.width(6.dp))
                            Text("Salin Token")
                        }
                        OutlinedButton(
                            onClick = onRotateDeviceToken,
                            colors = ButtonDefaults.outlinedButtonColors(contentColor = RedDanger),
                            modifier = Modifier.weight(1f)
                        ) {
                            Icon(Icons.Default.VpnKey, contentDescription = null, modifier = Modifier.size(16.dp))
                            Spacer(modifier = Modifier.width(6.dp))
                            Text("Putar Token")
                        }
                    }
                }
            }

            item {
                SectionCard(
                    title = "Manajemen Pengguna",
                    subtitle = "Kelola akun Admin, Waka Kurikulum, dan Guru Piket",
                    trailing = {
                        FilledTonalButton(onClick = { showCreateUserDialog = true }) {
                            Icon(Icons.Default.Add, contentDescription = null, modifier = Modifier.size(16.dp))
                            Spacer(modifier = Modifier.width(4.dp))
                            Text("User")
                        }
                    }
                ) {
                    if (state.users.isEmpty()) {
                        Text("Memuat daftar pengguna...", style = MaterialTheme.typography.bodySmall, color = SlateMuted)
                    }
                }
            }

            items(state.users, key = { it.id }) { u ->
                Card(
                    shape = RoundedCornerShape(14.dp),
                    colors = CardDefaults.cardColors(containerColor = SlateCard),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(14.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = u.displayName + if (u.id == user.id) " (Anda)" else "",
                                fontWeight = FontWeight.SemiBold
                            )
                            Text(
                                text = "@${u.username} • ${roleDisplayName(u.role)}",
                                style = MaterialTheme.typography.bodySmall,
                                color = SlateMuted
                            )
                            Spacer(modifier = Modifier.height(4.dp))
                            StatusPill(
                                text = if (u.active) "Aktif" else "Nonaktif",
                                containerColor = if (u.active) EmeraldContainer else RedContainer,
                                contentColor = if (u.active) EmeraldAccent else RedDanger
                            )
                        }
                        IconButton(onClick = { editingUser = u }) {
                            Icon(Icons.Default.Edit, contentDescription = "Edit user", tint = NavyPrimary)
                        }
                        if (u.id != user.id) {
                            IconButton(onClick = { onDeleteUser(u.id) }) {
                                Icon(Icons.Default.Delete, contentDescription = "Hapus user", tint = RedDanger)
                            }
                        }
                    }
                }
            }
        }
    }

    // Change Password Dialog
    if (showChangePasswordDialog) {
        var currentPw by remember { mutableStateOf("") }
        var newPw by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { showChangePasswordDialog = false },
            title = { Text("Ubah Password") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        value = currentPw,
                        onValueChange = { currentPw = it },
                        label = { Text("Password Saat Ini") },
                        visualTransformation = PasswordVisualTransformation(),
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    OutlinedTextField(
                        value = newPw,
                        onValueChange = { newPw = it },
                        label = { Text("Password Baru (min. 6 karakter)") },
                        visualTransformation = PasswordVisualTransformation(),
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        onChangePassword(currentPw, newPw) {
                            showChangePasswordDialog = false
                        }
                    },
                    enabled = currentPw.isNotEmpty() && newPw.length >= 6
                ) {
                    Text("Simpan")
                }
            },
            dismissButton = {
                TextButton(onClick = { showChangePasswordDialog = false }) { Text("Batal") }
            }
        )
    }

    // Create User Dialog
    if (showCreateUserDialog) {
        var username by remember { mutableStateOf("") }
        var displayName by remember { mutableStateOf("") }
        var role by remember { mutableStateOf("piket") }
        var password by remember { mutableStateOf("") }

        AlertDialog(
            onDismissRequest = { showCreateUserDialog = false },
            title = { Text("Tambah Pengguna") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        value = username,
                        onValueChange = { username = it },
                        label = { Text("Username (min. 3 huruf)") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    OutlinedTextField(
                        value = displayName,
                        onValueChange = { displayName = it },
                        label = { Text("Nama Tampilan") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    Text("Role:", style = MaterialTheme.typography.labelMedium)
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        listOf("admin" to "Admin", "waka" to "Waka", "piket" to "Piket").forEach { (rKey, rLabel) ->
                            FilterChip(
                                selected = role == rKey,
                                onClick = { role = rKey },
                                label = { Text(rLabel) }
                            )
                        }
                    }
                    OutlinedTextField(
                        value = password,
                        onValueChange = { password = it },
                        label = { Text("Password (min. 6 karakter)") },
                        visualTransformation = PasswordVisualTransformation(),
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        onCreateUser(username.trim(), displayName.trim(), role, password) {
                            showCreateUserDialog = false
                        }
                    },
                    enabled = username.trim().length >= 3 && displayName.trim().length >= 2 && password.length >= 6
                ) {
                    Text("Buat User")
                }
            },
            dismissButton = {
                TextButton(onClick = { showCreateUserDialog = false }) { Text("Batal") }
            }
        )
    }

    // Edit User Dialog
    editingUser?.let { target ->
        var displayName by remember { mutableStateOf(target.displayName) }
        var role by remember { mutableStateOf(target.role) }
        var active by remember { mutableStateOf(target.active) }
        var newPassword by remember { mutableStateOf("") }

        AlertDialog(
            onDismissRequest = { editingUser = null },
            title = { Text("Edit User @${target.username}") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        value = displayName,
                        onValueChange = { displayName = it },
                        label = { Text("Nama Tampilan") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        listOf("admin" to "Admin", "waka" to "Waka", "piket" to "Piket").forEach { (rKey, rLabel) ->
                            FilterChip(
                                selected = role == rKey,
                                onClick = { role = rKey },
                                label = { Text(rLabel) }
                            )
                        }
                    }
                    if (target.id != user.id) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Text("Akun Aktif")
                            Switch(checked = active, onCheckedChange = { active = it })
                        }
                    }
                    OutlinedTextField(
                        value = newPassword,
                        onValueChange = { newPassword = it },
                        label = { Text("Reset Password (kosongkan jika tetap)") },
                        visualTransformation = PasswordVisualTransformation(),
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        onUpdateUser(
                            target.id,
                            displayName.trim(),
                            role,
                            if (target.id == user.id) null else active,
                            newPassword.takeIf { it.isNotEmpty() }
                        )
                        editingUser = null
                    },
                    enabled = displayName.trim().length >= 2 && (newPassword.isEmpty() || newPassword.length >= 6)
                ) {
                    Text("Simpan")
                }
            },
            dismissButton = {
                TextButton(onClick = { editingUser = null }) { Text("Batal") }
            }
        )
    }
}
