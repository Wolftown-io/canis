package io.wolftown.kaiku.data

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNamingStrategy

@OptIn(kotlinx.serialization.ExperimentalSerializationApi::class)
val KaikuJson = Json {
    ignoreUnknownKeys = true
    namingStrategy = JsonNamingStrategy.SnakeCase
    encodeDefaults = true
}
