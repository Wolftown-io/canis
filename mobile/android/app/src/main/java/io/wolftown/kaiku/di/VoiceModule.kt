package io.wolftown.kaiku.di

import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import io.wolftown.kaiku.data.api.VoiceApi
import io.wolftown.kaiku.data.api.VoiceApiImpl
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
abstract class VoiceModule {

    @Binds
    @Singleton
    abstract fun bindVoiceApi(impl: VoiceApiImpl): VoiceApi
}
