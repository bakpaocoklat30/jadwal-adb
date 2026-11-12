package id.sch.smkn1adw.beladb.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
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
import id.sch.smkn1adw.beladb.ui.components.parseHexColor
import id.sch.smkn1adw.beladb.ui.theme.*
import java.util.UUID

private val PRESET_COLORS = listOf("#2563eb", "#059669", "#d97706", "#7c3aed", "#dc2626", "#0891b2")

@Composable
fun ProfilesScreen(
    state: MainUiState,
    canEdit: Boolean,
    onSaveProfile: (existingId: String?, ProfileUpsertRequest) -> Unit,
    onDuplicateProfile: (id: String) -> Unit,
    onShiftProfile: (id: String, deltaMinutes: Int) -> Unit,
    onDeleteProfile: (id: String) -> Unit,
    onPlaySlot: (label: String, steps: List<AudioStep>) -> Unit,
    onGeneratePreview: (
        startTime: String,
        lessonCount: Int,
        lessonDurationMinutes: Int,
        introFileName: String?,
        introDelayMs: Int?,
        lessonFilePattern: String?,
        endOfDayLabel: String?,
        endOfDayFileName: String?,
        breaks: List<GenerateScheduleBreak>,
        onGenerated: (List<ScheduleSlot>) -> Unit
    ) -> Unit
) {
    val profiles = state.snapshot?.profiles.orEmpty()
    var selectedProfileId by remember { mutableStateOf<String?>(null) }
    val selectedProfile = profiles.firstOrNull { it.id == selectedProfileId } ?: profiles.firstOrNull()

    val availableAudioPaths = remember(state.localAudioFiles, state.serverAudioFiles) {
        val local = state.localAudioFiles.map { it.relativePath }
        val web = state.serverAudioFiles.map { "_web/${it.fileName}" }
        (local + web).distinct().sorted()
    }

    var showProfileDialog by remember { mutableStateOf<ScheduleProfile?>(null) }
    var isCreatingProfile by remember { mutableStateOf(false) }

    var editingSlot by remember { mutableStateOf<ScheduleSlot?>(null) }
    var isAddingSlot by remember { mutableStateOf(false) }

    var showShiftDialog by remember { mutableStateOf(false) }
    var showGeneratorDialog by remember { mutableStateOf(false) }
    var confirmDeleteProfile by remember { mutableStateOf<ScheduleProfile?>(null) }

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .background(SlateBg),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        // Header & Add Profile button
        item {
            SectionCard(
                title = "Profil Jadwal Bel",
                subtitle = "Pilih profil untuk melihat atau mengubah jam bel",
                trailing = {
                    if (canEdit) {
                        Button(
                            onClick = {
                                isCreatingProfile = true
                                showProfileDialog = ScheduleProfile(
                                    id = "",
                                    name = "",
                                    description = "",
                                    color = PRESET_COLORS.first()
                                )
                            },
                            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp)
                        ) {
                            Icon(Icons.Default.Add, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(modifier = Modifier.width(4.dp))
                            Text("Profil")
                        }
                    }
                }
            ) {
                if (profiles.isEmpty()) {
                    Text("Belum ada profil jadwal.", style = MaterialTheme.typography.bodySmall, color = SlateMuted)
                } else {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        profiles.forEach { prof ->
                            val isSelected = prof.id == selectedProfile?.id
                            val dotColor = parseHexColor(prof.color)
                            FilterChip(
                                selected = isSelected,
                                onClick = { selectedProfileId = prof.id },
                                label = {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Box(
                                            modifier = Modifier
                                                .size(10.dp)
                                                .clip(CircleShape)
                                                .background(dotColor)
                                        )
                                        Spacer(modifier = Modifier.width(6.dp))
                                        Text("${prof.name} (${prof.slots.size})")
                                    }
                                }
                            )
                        }
                    }
                }
            }
        }

        // Selected Profile Detail & Actions
        if (selectedProfile != null) {
            item {
                SectionCard(
                    title = selectedProfile.name,
                    subtitle = selectedProfile.description.ifBlank { "${selectedProfile.slots.size} slot jadwal" }
                ) {
                    if (canEdit) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .horizontalScroll(rememberScrollState()),
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            FilledTonalButton(
                                onClick = {
                                    isAddingSlot = true
                                    editingSlot = ScheduleSlot(
                                        id = UUID.randomUUID().toString(),
                                        time = "07:00",
                                        label = "",
                                        enabled = true,
                                        steps = listOf(
                                            AudioStep(
                                                id = UUID.randomUUID().toString(),
                                                fileName = availableAudioPaths.firstOrNull() ?: ""
                                            )
                                        )
                                    )
                                }
                            ) {
                                Icon(Icons.Default.Add, contentDescription = null, modifier = Modifier.size(16.dp))
                                Spacer(modifier = Modifier.width(4.dp))
                                Text("Slot")
                            }
                            OutlinedButton(onClick = { showGeneratorDialog = true }) {
                                Icon(Icons.Default.AutoAwesome, contentDescription = null, modifier = Modifier.size(16.dp))
                                Spacer(modifier = Modifier.width(4.dp))
                                Text("Generator")
                            }
                            OutlinedButton(onClick = { showShiftDialog = true }) {
                                Icon(Icons.Default.FastForward, contentDescription = null, modifier = Modifier.size(16.dp))
                                Spacer(modifier = Modifier.width(4.dp))
                                Text("Geser Jam")
                            }
                            OutlinedButton(
                                onClick = {
                                    isCreatingProfile = false
                                    showProfileDialog = selectedProfile
                                }
                            ) {
                                Icon(Icons.Default.Edit, contentDescription = null, modifier = Modifier.size(16.dp))
                                Spacer(modifier = Modifier.width(4.dp))
                                Text("Ubah")
                            }
                            OutlinedButton(onClick = { onDuplicateProfile(selectedProfile.id) }) {
                                Icon(Icons.Default.ContentCopy, contentDescription = null, modifier = Modifier.size(16.dp))
                                Spacer(modifier = Modifier.width(4.dp))
                                Text("Duplikat")
                            }
                            OutlinedButton(
                                onClick = { confirmDeleteProfile = selectedProfile },
                                colors = ButtonDefaults.outlinedButtonColors(contentColor = RedDanger)
                            ) {
                                Icon(Icons.Default.Delete, contentDescription = null, modifier = Modifier.size(16.dp))
                                Spacer(modifier = Modifier.width(4.dp))
                                Text("Hapus")
                            }
                        }
                    }
                }
            }

            val sortedSlots = selectedProfile.slots.sortedBy { it.time }
            if (sortedSlots.isEmpty()) {
                item {
                    SectionCard {
                        Text(
                            text = "Profil ini belum memiliki slot bel. Gunakan tombol + Slot atau Generator untuk mengisi jam bel.",
                            style = MaterialTheme.typography.bodySmall,
                            color = SlateMuted
                        )
                    }
                }
            } else {
                items(sortedSlots, key = { it.id }) { slot ->
                    Card(
                        shape = RoundedCornerShape(14.dp),
                        colors = CardDefaults.cardColors(containerColor = SlateCard),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(12.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column(
                                modifier = Modifier.width(64.dp),
                                horizontalAlignment = Alignment.CenterHorizontally
                            ) {
                                Text(
                                    text = slot.time,
                                    style = MaterialTheme.typography.titleMedium,
                                    fontWeight = FontWeight.Bold,
                                    color = if (slot.enabled) NavyPrimary else SlateMuted
                                )
                                if (!slot.enabled) {
                                    StatusPill("OFF", RedContainer, RedDanger)
                                }
                            }
                            Spacer(modifier = Modifier.width(8.dp))
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    text = slot.label,
                                    fontWeight = FontWeight.SemiBold,
                                    color = if (slot.enabled) SlateText else SlateMuted
                                )
                                Text(
                                    text = slot.steps.joinToString(" → ") {
                                        "${it.fileName} (${it.volume}%)"
                                    },
                                    style = MaterialTheme.typography.bodySmall,
                                    color = SlateMuted
                                )
                            }
                            IconButton(
                                onClick = { onPlaySlot(slot.label, slot.steps) },
                                enabled = state.deviceStatus.online && slot.steps.isNotEmpty()
                            ) {
                                Icon(
                                    Icons.Default.PlayArrow,
                                    contentDescription = "Bunyikan di PC Bel",
                                    tint = if (state.deviceStatus.online) EmeraldAccent else SlateMuted
                                )
                            }
                            if (canEdit) {
                                IconButton(
                                    onClick = {
                                        isAddingSlot = false
                                        editingSlot = slot
                                    }
                                ) {
                                    Icon(Icons.Default.Edit, contentDescription = "Edit slot", tint = NavyPrimary)
                                }
                                IconButton(
                                    onClick = {
                                        val updatedSlots = selectedProfile.slots.filterNot { it.id == slot.id }
                                        onSaveProfile(
                                            selectedProfile.id,
                                            ProfileUpsertRequest(
                                                name = selectedProfile.name,
                                                description = selectedProfile.description,
                                                color = selectedProfile.color,
                                                slots = updatedSlots
                                            )
                                        )
                                    }
                                ) {
                                    Icon(Icons.Default.Delete, contentDescription = "Hapus slot", tint = RedDanger)
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // Create / Edit Profile Dialog
    showProfileDialog?.let { prof ->
        var name by remember { mutableStateOf(prof.name) }
        var desc by remember { mutableStateOf(prof.description) }
        var color by remember { mutableStateOf(prof.color) }

        AlertDialog(
            onDismissRequest = { showProfileDialog = null },
            title = { Text(if (isCreatingProfile) "Tambah Profil Jadwal" else "Ubah Profil") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    OutlinedTextField(
                        value = name,
                        onValueChange = { name = it },
                        label = { Text("Nama Profil") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    OutlinedTextField(
                        value = desc,
                        onValueChange = { desc = it },
                        label = { Text("Deskripsi (opsional)") },
                        modifier = Modifier.fillMaxWidth()
                    )
                    Text("Warna Label:", style = MaterialTheme.typography.labelMedium)
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        PRESET_COLORS.forEach { hex ->
                            Box(
                                modifier = Modifier
                                    .size(30.dp)
                                    .clip(CircleShape)
                                    .background(parseHexColor(hex))
                                    .clickable { color = hex },
                                contentAlignment = Alignment.Center
                            ) {
                                if (color == hex) {
                                    Icon(
                                        Icons.Default.CheckCircle,
                                        contentDescription = null,
                                        tint = Color.White,
                                        modifier = Modifier.size(18.dp)
                                    )
                                }
                            }
                        }
                    }
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        onSaveProfile(
                            if (isCreatingProfile) null else prof.id,
                            ProfileUpsertRequest(
                                name = name.trim(),
                                description = desc.trim(),
                                color = color,
                                slots = prof.slots
                            )
                        )
                        showProfileDialog = null
                    },
                    enabled = name.isNotBlank()
                ) {
                    Text("Simpan")
                }
            },
            dismissButton = {
                TextButton(onClick = { showProfileDialog = null }) { Text("Batal") }
            }
        )
    }

    // Add / Edit Slot Dialog
    editingSlot?.let { initialSlot ->
        if (selectedProfile != null) {
            SlotEditorDialog(
                initialSlot = initialSlot,
                isNew = isAddingSlot,
                availableAudioPaths = availableAudioPaths,
                onDismiss = { editingSlot = null },
                onSave = { updated ->
                    val nextSlots = if (isAddingSlot) {
                        selectedProfile.slots + updated
                    } else {
                        selectedProfile.slots.map { if (it.id == updated.id) updated else it }
                    }.sortedBy { it.time }

                    onSaveProfile(
                        selectedProfile.id,
                        ProfileUpsertRequest(
                            name = selectedProfile.name,
                            description = selectedProfile.description,
                            color = selectedProfile.color,
                            slots = nextSlots
                        )
                    )
                    editingSlot = null
                }
            )
        }
    }

    // Shift Slots Dialog
    if (showShiftDialog && selectedProfile != null) {
        var minutesText by remember { mutableStateOf("15") }
        AlertDialog(
            onDismissRequest = { showShiftDialog = false },
            title = { Text("Geser Semua Jam (${selectedProfile.name})") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        "Masukkan jumlah menit positif (+) untuk memundurkan atau negatif (-) untuk memajukan semua jam slot.",
                        style = MaterialTheme.typography.bodySmall,
                        color = SlateMuted
                    )
                    OutlinedTextField(
                        value = minutesText,
                        onValueChange = { minutesText = it },
                        label = { Text("Menit (-360 s/d 360)") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        val delta = (minutesText.toIntOrNull() ?: 0).coerceIn(-360, 360)
                        onShiftProfile(selectedProfile.id, delta)
                        showShiftDialog = false
                    },
                    enabled = minutesText.toIntOrNull() != null
                ) {
                    Text("Terapkan")
                }
            },
            dismissButton = {
                TextButton(onClick = { showShiftDialog = false }) { Text("Batal") }
            }
        )
    }

    // Schedule Generator Dialog
    if (showGeneratorDialog && selectedProfile != null) {
        var startTime by remember { mutableStateOf("07:00") }
        var lessonCount by remember { mutableStateOf("8") }
        var lessonDur by remember { mutableStateOf("45") }
        var pattern by remember { mutableStateOf(availableAudioPaths.firstOrNull() ?: "jam_{n}.mp3") }
        var endLabel by remember { mutableStateOf("Pulang") }
        var endFile by remember { mutableStateOf(availableAudioPaths.firstOrNull() ?: "") }

        AlertDialog(
            onDismissRequest = { showGeneratorDialog = false },
            title = { Text("Generator Jadwal Otomatis") },
            text = {
                Column(
                    modifier = Modifier.verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Text(
                        "Akan mengganti daftar slot pada '${selectedProfile.name}'.",
                        style = MaterialTheme.typography.bodySmall,
                        color = AmberWarn
                    )
                    OutlinedTextField(
                        value = startTime,
                        onValueChange = { startTime = it },
                        label = { Text("Jam Mulai (HH:MM)") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    OutlinedTextField(
                        value = lessonCount,
                        onValueChange = { lessonCount = it.filter { ch -> ch.isDigit() } },
                        label = { Text("Jumlah Jam Pelajaran (1–16)") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    OutlinedTextField(
                        value = lessonDur,
                        onValueChange = { lessonDur = it.filter { ch -> ch.isDigit() } },
                        label = { Text("Durasi per Jam (menit)") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    OutlinedTextField(
                        value = pattern,
                        onValueChange = { pattern = it },
                        label = { Text("Pola File Audio (misal jam_{n}.mp3)") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    OutlinedTextField(
                        value = endLabel,
                        onValueChange = { endLabel = it },
                        label = { Text("Label Jam Pulang (opsional)") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    OutlinedTextField(
                        value = endFile,
                        onValueChange = { endFile = it },
                        label = { Text("File Audio Pulang (opsional)") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        val count = (lessonCount.toIntOrNull() ?: 8).coerceIn(1, 16)
                        val dur = (lessonDur.toIntOrNull() ?: 45).coerceIn(10, 120)
                        onGeneratePreview(
                            startTime.trim(),
                            count,
                            dur,
                            null,
                            null,
                            pattern.trim().ifBlank { null },
                            endLabel.trim().ifBlank { null },
                            endFile.trim().ifBlank { null },
                            emptyList()
                        ) { generatedSlots ->
                            onSaveProfile(
                                selectedProfile.id,
                                ProfileUpsertRequest(
                                    name = selectedProfile.name,
                                    description = selectedProfile.description,
                                    color = selectedProfile.color,
                                    slots = generatedSlots
                                )
                            )
                        }
                        showGeneratorDialog = false
                    }
                ) {
                    Text("Buat & Simpan")
                }
            },
            dismissButton = {
                TextButton(onClick = { showGeneratorDialog = false }) { Text("Batal") }
            }
        )
    }

    // Confirm Delete Profile Dialog
    confirmDeleteProfile?.let { target ->
        AlertDialog(
            onDismissRequest = { confirmDeleteProfile = null },
            title = { Text("Hapus Profil?") },
            text = { Text("Yakin ingin menghapus profil '${target.name}'?") },
            confirmButton = {
                Button(
                    onClick = {
                        onDeleteProfile(target.id)
                        confirmDeleteProfile = null
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = RedDanger)
                ) {
                    Text("Hapus")
                }
            },
            dismissButton = {
                TextButton(onClick = { confirmDeleteProfile = null }) { Text("Batal") }
            }
        )
    }
}

@Composable
private fun SlotEditorDialog(
    initialSlot: ScheduleSlot,
    isNew: Boolean,
    availableAudioPaths: List<String>,
    onDismiss: () -> Unit,
    onSave: (ScheduleSlot) -> Unit
) {
    var time by remember { mutableStateOf(initialSlot.time) }
    var label by remember { mutableStateOf(initialSlot.label) }
    var enabled by remember { mutableStateOf(initialSlot.enabled) }
    var steps by remember {
        mutableStateOf(
            if (initialSlot.steps.isNotEmpty()) initialSlot.steps
            else listOf(AudioStep(id = UUID.randomUUID().toString(), fileName = ""))
        )
    }
    var pickingAudioForStepIndex by remember { mutableStateOf<Int?>(null) }

    val timeValid = Regex("^([01]\\d|2[0-3]):([0-5]\\d)$").matches(time.trim())
    val stepsValid = steps.isNotEmpty() && steps.all { it.fileName.isNotBlank() }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (isNew) "Tambah Slot Bel" else "Edit Slot Bel") },
        text = {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(max = 420.dp)
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                OutlinedTextField(
                    value = time,
                    onValueChange = { time = it },
                    label = { Text("Jam (HH:MM, contoh 07:00)") },
                    isError = !timeValid,
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                OutlinedTextField(
                    value = label,
                    onValueChange = { label = it },
                    label = { Text("Keterangan / Label") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text("Aktifkan slot ini")
                    Switch(checked = enabled, onCheckedChange = { enabled = it })
                }

                HorizontalDivider()
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text("Urutan Audio", fontWeight = FontWeight.SemiBold)
                    TextButton(
                        onClick = {
                            steps = steps + AudioStep(
                                id = UUID.randomUUID().toString(),
                                fileName = availableAudioPaths.firstOrNull() ?: ""
                            )
                        }
                    ) {
                        Text("+ Langkah")
                    }
                }

                steps.forEachIndexed { idx, step ->
                    Surface(
                        color = SlateBg,
                        shape = RoundedCornerShape(10.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Column(
                            modifier = Modifier.padding(10.dp),
                            verticalArrangement = Arrangement.spacedBy(6.dp)
                        ) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text("Audio #${idx + 1}", style = MaterialTheme.typography.labelMedium)
                                Row {
                                    if (availableAudioPaths.isNotEmpty()) {
                                        TextButton(onClick = { pickingAudioForStepIndex = idx }) {
                                            Text("Pilih File")
                                        }
                                    }
                                    if (steps.size > 1) {
                                        IconButton(onClick = {
                                            steps = steps.filterIndexed { i, _ -> i != idx }
                                        }) {
                                            Icon(Icons.Default.Delete, contentDescription = "Hapus audio", tint = RedDanger)
                                        }
                                    }
                                }
                            }
                            OutlinedTextField(
                                value = step.fileName,
                                onValueChange = { value ->
                                    steps = steps.mapIndexed { i, s -> if (i == idx) s.copy(fileName = value) else s }
                                },
                                label = { Text("Nama/Path File Audio") },
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth()
                            )
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                OutlinedTextField(
                                    value = step.delayBeforeMs.toString(),
                                    onValueChange = { txt ->
                                        val v = txt.filter { it.isDigit() }.toIntOrNull() ?: 0
                                        steps = steps.mapIndexed { i, s ->
                                            if (i == idx) s.copy(delayBeforeMs = v.coerceIn(0, 120000)) else s
                                        }
                                    },
                                    label = { Text("Jeda (ms)") },
                                    singleLine = true,
                                    modifier = Modifier.weight(1f)
                                )
                                OutlinedTextField(
                                    value = step.volume.toString(),
                                    onValueChange = { txt ->
                                        val v = txt.filter { it.isDigit() }.toIntOrNull() ?: 100
                                        steps = steps.mapIndexed { i, s ->
                                            if (i == idx) s.copy(volume = v.coerceIn(0, 100)) else s
                                        }
                                    },
                                    label = { Text("Vol (0-100)") },
                                    singleLine = true,
                                    modifier = Modifier.weight(1f)
                                )
                            }
                        }
                    }
                }
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    onSave(
                        initialSlot.copy(
                            time = time.trim(),
                            label = label.trim(),
                            enabled = enabled,
                            steps = steps.map { it.copy(fileName = it.fileName.trim()) }
                        )
                    )
                },
                enabled = timeValid && label.isNotBlank() && stepsValid
            ) {
                Text("Simpan Slot")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Batal") }
        }
    )

    pickingAudioForStepIndex?.let { stepIdx ->
        AlertDialog(
            onDismissRequest = { pickingAudioForStepIndex = null },
            title = { Text("Pilih Audio untuk Langkah #${stepIdx + 1}") },
            text = {
                LazyColumn(modifier = Modifier.heightIn(max = 320.dp)) {
                    items(availableAudioPaths) { path ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    steps = steps.mapIndexed { i, s ->
                                        if (i == stepIdx) s.copy(fileName = path) else s
                                    }
                                    pickingAudioForStepIndex = null
                                }
                                .padding(vertical = 10.dp, horizontal = 4.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(Icons.Default.MusicNote, contentDescription = null, tint = NavyPrimary, modifier = Modifier.size(18.dp))
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(path, style = MaterialTheme.typography.bodyMedium)
                        }
                        HorizontalDivider()
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { pickingAudioForStepIndex = null }) { Text("Tutup") }
            }
        )
    }
}
