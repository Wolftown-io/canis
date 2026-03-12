package io.wolftown.kaiku.di

import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import io.ktor.client.*
import io.wolftown.kaiku.data.api.KaikuHttpClient
import io.wolftown.kaiku.data.local.AuthState
import io.wolftown.kaiku.data.local.TokenStorage
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object NetworkModule {

    @Provides
    @Singleton
    fun provideKaikuHttpClient(
        tokenStorage: TokenStorage,
        authState: AuthState
    ): KaikuHttpClient {
        return KaikuHttpClient(tokenStorage, authState)
    }

    @Provides
    @Singleton
    fun provideHttpClient(kaikuHttpClient: KaikuHttpClient): HttpClient {
        return kaikuHttpClient.httpClient
    }
}
