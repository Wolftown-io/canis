package io.wolftown.kaiku.di

import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import io.wolftown.kaiku.data.api.AuthApi
import io.wolftown.kaiku.data.api.AuthApiImpl
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
abstract class AuthModule {

    @Binds
    @Singleton
    abstract fun bindAuthApi(impl: AuthApiImpl): AuthApi
}
