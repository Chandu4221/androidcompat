package dev.androidcompat.stub.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage

@Composable
fun MainScreen(viewModel: MainViewModel) {
    val entries by viewModel.entries.collectAsState()

    Column(modifier = Modifier
        .fillMaxSize()
        .padding(16.dp)) {
        // Coil image load — exercises Coil's network stack
        AsyncImage(
            model = "https://avatars.githubusercontent.com/u/1342004",
            contentDescription = "Test image",
            modifier = Modifier.size(64.dp)
        )

        Spacer(modifier = Modifier.height(16.dp))

        Button(onClick = {
            viewModel.addEntry("8.5.0", "2.0.0", "PASSED")
        }) {
            Text("Insert Test Entry")
        }

        Spacer(modifier = Modifier.height(16.dp))

        LazyColumn {
            items(entries) { entry ->
                Card(modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 4.dp)) {
                    Column(modifier = Modifier.padding(12.dp)) {
                        Text("AGP: ${entry.agpVersion}")
                        Text("Kotlin: ${entry.kotlinVersion}")
                        Text("Status: ${entry.status}")
                    }
                }
            }
        }
    }
}