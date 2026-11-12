package id.sch.smkn1adw.beladb.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import id.sch.smkn1adw.beladb.data.*
import id.sch.smkn1adw.beladb.ui.MainUiState
import id.sch.smkn1adw.beladb.ui.components.SectionCard
import id.sch.smkn1adw.beladb.ui.components.StatusPill
import id.sch.smkn1adw.beladb.ui.theme.*

@Composable
fun CalendarScreen(
    state: MainUiState,
    canEdit: Boolean,
    onSaveWeeklyRules: (List<WeeklyRuleInput>) -> Unit,
    onCreateOverride: (startDate: String, endDate: String, profileId: String?, note: String) -> Unit,
    onDeleteOverride: (id: String) -> Unit
) {
    val snapshot = state.snapshot
    val profiles = snapshot?.profiles.orEmpty()
    val profileById = remember(profiles) { profiles.associateBy { it.id } }

    // Ordered Senin(1)..Sabtu(6), Minggu(0) for Indonesia school display
    val orderedDays = listOf(1, 2, 3, 4, 5, 6, 0)

    var draftRules by remember(snapshot?.weeklyRules) {
        mutableStateOf(
            (0..6).associateWith { day ->
                snapshot?.weeklyRules?.firstOrNull { it.dayOfWeek == day }?.profileId
            }
        )
    }

    var pickingDayForWeekly by remember { mutableStateOf<Int?>(null) }
    var showAddOverrideDialog by remember { mutableStateOf(false) }

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .background(SlateBg),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        item {
            SectionCard(
                title = "Aturan Jadwal Mingguan",
                subtitle = "Profil default yang berulang setiap minggu",
                trailing = {
                    if (canEdit && snapshot != null) {
                        Button(
                            onClick = {
                                val list = (0..6).map { day ->
                                    WeeklyRuleInput(dayOfWeek = day, profileId = draftRules[day])
                                }
                                onSaveWeeklyRules(list)
                            },
                            enabled = !state.isBusy
                        ) {
                            Text("Simpan")
                        }
                    }
                }
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    orderedDays.forEach { day ->
                        val assignedId = draftRules[day]
                        val assignedName = assignedId?.let { profileById[it]?.name } ?: "Libur / Nonaktif"
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable(enabled = canEdit) { pickingDayForWeekly = day }
                                .padding(vertical = 8.dp, horizontal = 4.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Text(
                                text = DAY_NAMES_ID[day],
                                fontWeight = FontWeight.SemiBold,
                                modifier = Modifier.width(84.dp)
                            )
                            Text(
                                text = assignedName,
                                color = if (assignedId != null) NavyPrimary else SlateMuted,
                                fontWeight = FontWeight.Medium,
                                modifier = Modifier.weight(1f)
                            )
                            if (canEdit) {
                                Icon(
                                    Icons.Default.Edit,
                                    contentDescription = "Ubah",
                                    tint = SlateMuted,
                                    modifier = Modifier.size(18.dp)
                                )
                            }
                        }
                        HorizontalDivider()
                    }
                }
            }
        }

        item {
            SectionCard(
                title = "Pengecualian Tanggal / Hari Libur",
                subtitle = "Menimpa aturan mingguan untuk tanggal tertentu",
                trailing = {
                    if (canEdit && snapshot != null) {
                        FilledTonalButton(onClick = { showAddOverrideDialog = true }) {
                            Icon(Icons.Default.Add, contentDescription = null, modifier = Modifier.size(16.dp))
                            Spacer(modifier = Modifier.width(4.dp))
                            Text("Tambah")
                        }
                    }
                }
            ) {
                if (snapshot?.dateOverrides.isNullOrEmpty()) {
                    Text(
                        text = "Belum ada pengecualian tanggal.",
                        style = MaterialTheme.typography.bodySmall,
                        color = SlateMuted
                    )
                }
            }
        }

        val overrides = snapshot?.dateOverrides.orEmpty().sortedByDescending { it.startDate }
        items(overrides, key = { it.id }) { ov ->
            val profName = ov.profileId?.let { profileById[it]?.name } ?: "Libur / Matikan Bel"
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
                            text = if (ov.startDate == ov.endDate) ov.startDate else "${ov.startDate} s/d ${ov.endDate}",
                            fontWeight = FontWeight.Bold,
                            color = NavyPrimary
                        )
                        Text(
                            text = ov.note,
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = FontWeight.Medium
                        )
                        Spacer(modifier = Modifier.height(4.dp))
                        StatusPill(
                            text = profName,
                            containerColor = if (ov.profileId == null) RedContainer else NavyContainer,
                            contentColor = if (ov.profileId == null) RedDanger else NavyPrimary
                        )
                    }
                    if (canEdit) {
                        IconButton(onClick = { onDeleteOverride(ov.id) }) {
                            Icon(Icons.Default.Delete, contentDescription = "Hapus", tint = RedDanger)
                        }
                    }
                }
            }
        }
    }

    // Weekly day profile picker dialog
    pickingDayForWeekly?.let { day ->
        AlertDialog(
            onDismissRequest = { pickingDayForWeekly = null },
            title = { Text("Pilih Jadwal Hari ${DAY_NAMES_ID[day]}") },
            text = {
                Column {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable {
                                draftRules = draftRules.toMutableMap().apply { put(day, null) }
                                pickingDayForWeekly = null
                            }
                            .padding(vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        RadioButton(selected = draftRules[day] == null, onClick = null)
                        Spacer(modifier = Modifier.width(6.dp))
                        Text("Libur / Nonaktif")
                    }
                    profiles.forEach { prof ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    draftRules = draftRules.toMutableMap().apply { put(day, prof.id) }
                                    pickingDayForWeekly = null
                                }
                                .padding(vertical = 10.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            RadioButton(selected = draftRules[day] == prof.id, onClick = null)
                            Spacer(modifier = Modifier.width(6.dp))
                            Text(prof.name)
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { pickingDayForWeekly = null }) { Text("Tutup") }
            }
        )
    }

    // Add Date Override Dialog
    if (showAddOverrideDialog) {
        val defaultDate = remember(snapshot?.timeZone) {
            ScheduleResolver.getZonedTodayParts(snapshot?.timeZone ?: "Asia/Jakarta").first
        }
        var startDate by remember { mutableStateOf(defaultDate) }
        var endDate by remember { mutableStateOf(defaultDate) }
        var isHoliday by remember { mutableStateOf(true) }
        var selectedProfileId by remember { mutableStateOf(profiles.firstOrNull()?.id) }
        var note by remember { mutableStateOf("") }

        val dateRegex = Regex("^\\d{4}-\\d{2}-\\d{2}$")
        val valid = dateRegex.matches(startDate.trim()) &&
            dateRegex.matches(endDate.trim()) &&
            endDate.trim() >= startDate.trim() &&
            note.isNotBlank() &&
            (isHoliday || selectedProfileId != null)

        AlertDialog(
            onDismissRequest = { showAddOverrideDialog = false },
            title = { Text("Tambah Pengecualian Tanggal") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        value = startDate,
                        onValueChange = { startDate = it },
                        label = { Text("Tanggal Mulai (YYYY-MM-DD)") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    OutlinedTextField(
                        value = endDate,
                        onValueChange = { endDate = it },
                        label = { Text("Tanggal Selesai (YYYY-MM-DD)") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(checked = isHoliday, onCheckedChange = { isHoliday = it })
                        Text("Libur / Matikan Bel")
                    }
                    if (!isHoliday) {
                        profiles.forEach { prof ->
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clickable { selectedProfileId = prof.id },
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                RadioButton(selected = selectedProfileId == prof.id, onClick = null)
                                Text(prof.name)
                            }
                        }
                    }
                    OutlinedTextField(
                        value = note,
                        onValueChange = { note = it },
                        label = { Text("Keterangan (misal Libur Nasional / PAS)") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        onCreateOverride(
                            startDate.trim(),
                            endDate.trim(),
                            if (isHoliday) null else selectedProfileId,
                            note.trim()
                        )
                        showAddOverrideDialog = false
                    },
                    enabled = valid
                ) {
                    Text("Simpan")
                }
            },
            dismissButton = {
                TextButton(onClick = { showAddOverrideDialog = false }) { Text("Batal") }
            }
        )
    }
}
