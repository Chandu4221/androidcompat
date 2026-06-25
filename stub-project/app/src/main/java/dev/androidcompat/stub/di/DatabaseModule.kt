package dev.androidcompat.stub.di

import android.content.Context
import androidx.room.Room
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import dev.androidcompat.stub.data.AppDatabase
import dev.androidcompat.stub.data.CompatEntryDao
import javax.inject.Singleton


@Module
@InstallIn(SingletonComponent::class)
object DatabaseModule {

    @Provides
    @Singleton
    fun provideDatabase(@ApplicationContext context: Context): AppDatabase =
        Room.databaseBuilder(context, AppDatabase::class.java, "compat_db").build()

    @Provides
    fun provideDao(db: AppDatabase): CompatEntryDao = db.compatEntryDao()
}