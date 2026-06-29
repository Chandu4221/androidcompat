package dev.androidcompat.stub.data

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "compat_entries")
data class CompatEntry(
    @PrimaryKey(autoGenerate = true) val id: Int = 0,
    val agpVersion: String,
    val kotlinVersion: String,
    val status: String
)
