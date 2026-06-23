package dev.androidcompat.stub

import androidx.lifecycle.ViewModel
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject

@HiltViewModel
class StubViewModel @Inject constructor() : ViewModel()