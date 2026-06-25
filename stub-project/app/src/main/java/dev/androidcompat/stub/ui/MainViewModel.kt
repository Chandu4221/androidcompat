package dev.androidcompat.stub.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.androidcompat.stub.data.CompatEntry
import dev.androidcompat.stub.data.CompatEntryDao
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class MainViewModel @Inject constructor(
    private val dao: CompatEntryDao
) : ViewModel() {

    val entries: StateFlow<List<CompatEntry>> = dao.getAll()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    fun addEntry(agp: String, kotlin: String, status: String) {
        viewModelScope.launch {
            dao.insert(CompatEntry(agpVersion = agp, kotlinVersion = kotlin, status = status))
        }
    }
}