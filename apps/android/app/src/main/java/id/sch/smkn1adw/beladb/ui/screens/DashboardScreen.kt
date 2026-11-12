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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import id.sch.smkn1adw.beladb.data.*
import id.sch.smkn1adw.beladb.ui.MainUiState
import id.sch.smkn1adw.beladb.ui.components.SectionCard
import id.sch.smkn1adw.beladb.ui.components.StatusPill
import id.sch.smkn1adw.beladb.ui.theme.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DashboardScreen(
    state: MainUiState,
    onPlayManual: (label: String, steps: List<AudioStep>) -> Unit,
    onStopAudio: () -> Unit,
    onSyncNow: () -> Unit,
    onRemoteShutdown: (action: String, graceSeconds: Int, reason: String) -> Unit,
    onCancelShutdown: () -> Unit,
    onApplyTodayOverride: (profileId: String?, note: String) -> Unit,
    onRemoveOverride: (id: String) -> Unit
) {
    val snapshot = state.snapshot
    val device = state.deviceStatus

    val (dateStr, timeStr, dayOfWeek) = remember(snapshot?.timeZone, state.logs.size) {
        ScheduleResolver.getZonedTodayParts(snapshot?.timeZone ?: "Asia/Jakarta")
    }
    val resolvedToday = remember(snapshot, dateStr, dayOfWeek) {
        snapshot?.let { ScheduleResolver.resolveDay(it, dateStr, dayOfWeek) }
    }
    val nextSlot = remember(resolvedToday, timeStr) {
        resolvedToday?.let { ScheduleResolver.getNextSlot(it, timeStr) }
    }

    var showShutdownDialog by remember { mutableStateOf(false) }
    var shutdownAction by remember { mutableStateOf("shutdown") }
    var shutdownGrace by remember { mutableStateOf("20") }
    var shutdownReason by remember { mutableStateOf("Perintah jarak jauh dari Android") }

    var showTodayOverrideDialog by remember { mutableStateOf(false) }

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .background(SlateBg),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        // Shutdown countdown warning banner
        if (device.shutdownState == "pending" || device.shutdownState == "shutting_down") {
            item {
                Card(
                    colors = CardDefaults.cardColors(containerColor = RedContainer),
                    shape = RoundedCornerShape(16.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Default.Warning, contentDescription = null, tint = RedDanger)
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(
                                text = "PC Bel Akan ${if (device.shutdownAction == "restart") "Restart" else "Mati"} dalam ${device.shutdownRemainingSec ?: 0} detik",
                                fontWeight = FontWeight.Bold,
                                color = RedDanger
                            )
                        }
                        if (!device.shutdownReason.isNullOrBlank()) {
                            Spacer(modifier = Modifier.height(4.dp))
                            Text(
                                text = device.shutdownReason,
                                style = MaterialTheme.typography.bodySmall,
                                color = SlateText
                            )
                        }
                        Spacer(modifier = Modifier.height(10.dp))
                        Button(
                            onClick = onCancelShutdown,
                            colors = ButtonDefaults.buttonColors(containerColor = RedDanger)
                        ) {
                            Text("Batalkan Shutdown")
                        }
                    }
                }
            }
        }

        // Playing status banner
        if (device.isPlaying) {
            item {
                Card(
                    colors = CardDefaults.cardColors(containerColor = EmeraldContainer),
                    shape = RoundedCornerShape(16.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Row(
                            modifier = Modifier.weight(1f),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(Icons.Default.VolumeUp, contentDescription = null, tint = EmeraldAccent)
                            Spacer(modifier = Modifier.width(10.dp))
                            Column {
                                Text(
                                    text = "Sedang Memutar di PC Bel",
                                    style = MaterialTheme.typography.labelMedium,
                                    color = Color(0xFF064E3B),
                                    fontWeight = FontWeight.Bold
                                )
                                Text(
                                    text = device.currentPlayingLabel ?: "Audio Bel",
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = SlateText
                                )
                            }
                        }
                        Button(
                            onClick = onStopAudio,
                            colors = ButtonDefaults.buttonColors(containerColor = RedDanger)
                        ) {
                            Icon(Icons.Default.Stop, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(modifier = Modifier.width(4.dp))
                            Text("Stop")
                        }
                    }
                }
            }
        }

        // PC Bel Status Card
        item {
            SectionCard(
                title = "Status PC Bel",
                subtitle = "${device.deviceName} • Versi Jadwal v${device.activeScheduleVersion}",
                trailing = {
                    StatusPill(
                        text = if (device.online) "ONLINE" else "OFFLINE",
                        containerColor = if (device.online) EmeraldContainer else RedContainer,
                        contentColor = if (device.online) EmeraldAccent else RedDanger
                    )
                }
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text("Audio Lokal PC", style = MaterialTheme.typography.labelSmall, color = SlateMuted)
                        Text("${device.audioCount} file", fontWeight = FontWeight.SemiBold)
                    }
                    Column(modifier = Modifier.weight(1f)) {
                        Text("Sinkron Terakhir", style = MaterialTheme.typography.labelSmall, color = SlateMuted)
                        Text(formatShortTime(device.lastSyncAt), fontWeight = FontWeight.SemiBold)
                    }
                }

                Spacer(modifier = Modifier.height(12.dp))

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    OutlinedButton(
                        onClick = onSyncNow,
                        enabled = device.online && !state.isBusy,
                        modifier = Modifier.weight(1f)
                    ) {
                        Icon(Icons.Default.Sync, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(modifier = Modifier.width(6.dp))
                        Text("Sync PC Bel")
                    }
                    OutlinedButton(
                        onClick = { showShutdownDialog = true },
                        enabled = device.online && !state.isBusy,
                        modifier = Modifier.weight(1f),
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = RedDanger)
                    ) {
                        Icon(Icons.Default.PowerSettingsNew, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(modifier = Modifier.width(6.dp))
                        Text("Matikan PC")
                    }
                }
            }
        }

        // Today Schedule & Quick Piket Override
        item {
            val activeProfileName = when {
                resolvedToday == null -> "Memuat..."
                resolvedToday.profile != null -> resolvedToday.profile.name
                resolvedToday.source == "override" -> "Libur / Bel Nonaktif"
                else -> "Tidak Ada Profil"
            }
            val sourceLabel = when (resolvedToday?.source) {
                "override" -> "Override: ${resolvedToday.override?.note ?: "Khusus"}"
                "weekly" -> "Jadwal Mingguan (${DAY_NAMES_ID[dayOfWeek]})"
                else -> "${DAY_NAMES_ID[dayOfWeek]}, $dateStr"
            }

            SectionCard(
                title = "Jadwal Hari Ini (${DAY_NAMES_ID[dayOfWeek]})",
                subtitle = "$dateStr • $sourceLabel",
                trailing = {
                    FilledTonalButton(
                        onClick = { showTodayOverrideDialog = true },
                        enabled = snapshot != null && !state.isBusy,
                        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp)
                    ) {
                        Icon(Icons.Default.Edit, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(modifier = Modifier.width(4.dp))
                        Text("Ubah Hari Ini")
                    }
                }
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text("Profil Aktif", style = MaterialTheme.typography.labelSmall, color = SlateMuted)
                        Text(activeProfileName, fontWeight = FontWeight.Bold, color = NavyPrimary)
                    }
                    if (nextSlot != null) {
                        Column(horizontalAlignment = Alignment.End) {
                            Text("Bel Berikutnya", style = MaterialTheme.typography.labelSmall, color = SlateMuted)
                            Text("${nextSlot.time} • ${nextSlot.label}", fontWeight = FontWeight.SemiBold, color = EmeraldAccent)
                        }
                    }
                }

                if (resolvedToday?.override != null) {
                    Spacer(modifier = Modifier.height(10.dp))
                    Surface(
                        color = AmberContainer,
                        shape = RoundedCornerShape(10.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Text(
                                text = "Override aktif: ${resolvedToday.override.note}",
                                style = MaterialTheme.typography.bodySmall,
                                color = SlateText,
                                modifier = Modifier.weight(1f)
                            )
                            TextButton(
                                onClick = { onRemoveOverride(resolvedToday.override.id) }
                            ) {
                                Text("Batalkan", color = RedDanger)
                            }
                        }
                    }
                }

                Spacer(modifier = Modifier.height(12.dp))

                val slots = resolvedToday?.slots.orEmpty()
                if (slots.isEmpty()) {
                    Text(
                        text = "Tidak ada slot bel aktif untuk hari ini.",
                        style = MaterialTheme.typography.bodySmall,
                        color = SlateMuted
                    )
                } else {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        slots.forEach { slot ->
                            val isNext = nextSlot?.id == slot.id
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(10.dp))
                                    .background(if (isNext) NavyContainer.copy(alpha = 0.45f) else Color(0xFFF8FAFC))
                                    .padding(horizontal = 12.dp, vertical = 10.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(
                                    text = slot.time,
                                    style = MaterialTheme.typography.titleSmall,
                                    fontWeight = FontWeight.Bold,
                                    color = if (slot.enabled) NavyPrimary else SlateMuted,
                                    modifier = Modifier.width(56.dp)
                                )
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(
                                        text = slot.label + if (!slot.enabled) " (Nonaktif)" else "",
                                        style = MaterialTheme.typography.bodyMedium,
                                        fontWeight = FontWeight.Medium,
                                        color = if (slot.enabled) SlateText else SlateMuted
                                    )
                                    Text(
                                        text = slot.steps.joinToString(" → ") { it.fileName },
                                        style = MaterialTheme.typography.bodySmall,
                                        color = SlateMuted
                                    )
                                }
                                IconButton(
                                    onClick = { onPlayManual(slot.label, slot.steps) },
                                    enabled = device.online && slot.steps.isNotEmpty()
                                ) {
                                    Icon(
                                        imageVector = Icons.Default.PlayArrow,
                                        contentDescription = "Putar di PC Bel",
                                        tint = if (device.online) EmeraldAccent else SlateMuted
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }

        // Recent Logs Section Header
        item {
            SectionCard(title = "Riwayat Bunyi Terakhir") {
                if (state.logs.isEmpty()) {
                    Text("Belum ada riwayat log.", style = MaterialTheme.typography.bodySmall, color = SlateMuted)
                }
            }
        }

        items(state.logs.take(20), key = { it.id }) { log ->
            Card(
                shape = RoundedCornerShape(12.dp),
                colors = CardDefaults.cardColors(containerColor = SlateCard),
                modifier = Modifier.fillMaxWidth()
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(12.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    val ok = log.status == "played"
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = log.slotLabel,
                            fontWeight = FontWeight.SemiBold,
                            style = MaterialTheme.typography.bodyMedium
                        )
                        Text(
                            text = "${formatShortTime(log.occurredAt)} • ${log.triggerType}" +
                                (log.actorName?.let { " • oleh $it" } ?: ""),
                            style = MaterialTheme.typography.bodySmall,
                            color = SlateMuted
                        )
                        if (!log.detail.isNullOrBlank()) {
                            Text(
                                text = log.detail,
                                style = MaterialTheme.typography.bodySmall,
                                color = if (ok) SlateMuted else RedDanger
                            )
                        }
                    }
                    StatusPill(
                        text = log.status,
                        containerColor = if (ok) EmeraldContainer else AmberContainer,
                        contentColor = if (ok) EmeraldAccent else AmberWarn
                    )
                }
            }
        }
    }

    // Remote Shutdown Dialog
    if (showShutdownDialog) {
        AlertDialog(
            onDismissRequest = { showShutdownDialog = false },
            title = { Text("Matikan / Restart PC Bel") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        FilterChip(
                            selected = shutdownAction == "shutdown",
                            onClick = { shutdownAction = "shutdown" },
                            label = { Text("Shutdown") }
                        )
                        FilterChip(
                            selected = shutdownAction == "restart",
                            onClick = { shutdownAction = "restart" },
                            label = { Text("Restart") }
                        )
                    }
                    OutlinedTextField(
                        value = shutdownGrace,
                        onValueChange = { shutdownGrace = it.filter { ch -> ch.isDigit() } },
                        label = { Text("Jeda peringatan (5–120 detik)") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    OutlinedTextField(
                        value = shutdownReason,
                        onValueChange = { shutdownReason = it },
                        label = { Text("Alasan") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        val grace = (shutdownGrace.toIntOrNull() ?: 20).coerceIn(5, 120)
                        onRemoteShutdown(shutdownAction, grace, shutdownReason.ifBlank { "Perintah Android" })
                        showShutdownDialog = false
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = RedDanger)
                ) {
                    Text("Kirim Perintah")
                }
            },
            dismissButton = {
                TextButton(onClick = { showShutdownDialog = false }) {
                    Text("Batal")
                }
            }
        )
    }

    // Quick Today Override Dialog (for Piket / Waka / Admin)
    if (showTodayOverrideDialog && snapshot != null) {
        var selectedProfileId by remember { mutableStateOf(resolvedToday?.profile?.id) }
        var isHoliday by remember { mutableStateOf(resolvedToday?.profile == null && resolvedToday?.source == "override") }
        var note by remember { mutableStateOf(resolvedToday?.override?.note ?: "Penyesuaian Piket") }

        AlertDialog(
            onDismissRequest = { showTodayOverrideDialog = false },
            title = { Text("Ubah Jadwal Hari Ini ($dateStr)") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(
                            checked = isHoliday,
                            onCheckedChange = {
                                isHoliday = it
                                if (it) selectedProfileId = null
                            }
                        )
                        Text("Liburkan / Matikan semua bel hari ini")
                    }
                    if (!isHoliday) {
                        Text("Pilih Profil Pengganti:", style = MaterialTheme.typography.labelMedium)
                        snapshot.profiles.forEach { prof ->
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                RadioButton(
                                    selected = selectedProfileId == prof.id,
                                    onClick = { selectedProfileId = prof.id }
                                )
                                Text(prof.name, modifier = Modifier.padding(start = 4.dp))
                            }
                        }
                    }
                    OutlinedTextField(
                        value = note,
                        onValueChange = { note = it },
                        label = { Text("Catatan") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        val finalProfile = if (isHoliday) null else selectedProfileId
                        onApplyTodayOverride(finalProfile, note.ifBlank { "Penyesuaian hari ini" })
                        showTodayOverrideDialog = false
                    },
                    enabled = isHoliday || selectedProfileId != null
                ) {
                    Text("Terapkan")
                }
            },
            dismissButton = {
                TextButton(onClick = { showTodayOverrideDialog = false }) {
                    Text("Batal")
                }
            }
        )
    }
}
