package dev.androidcompat.stub.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface CompatEntryDao {
    @Insert
    suspend fun insert(entry: CompatEntry)

    @Query("SELECT * FROM compat_entries")
    fun getAll(): Flow<List<CompatEntry>>
}