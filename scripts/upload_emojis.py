
import os
import sys
import requests
import json
import mimetypes

# Configuration
API_URL = "http://localhost:3000"
USERNAME = "admin"
PASSWORD = "password" # Assumes default admin seeded or user created

def get_token():
    print(f"Logging in as {USERNAME}...")
    try:
        res = requests.post(f"{API_URL}/auth/login", json={
            "username": USERNAME,
            "password": PASSWORD
        })
        res.raise_for_status()
        data = res.json()
        print("Login successful.")
        return data["access_token"]
    except Exception as e:
        print(f"Login failed: {e}")
        if hasattr(e, 'response') and e.response:
             print(e.response.text)
        sys.exit(1)

def create_guild(token, name="Emoji Test Guild"):
    print(f"Creating test guild '{name}'...")
    try:
        res = requests.post(
            f"{API_URL}/api/guilds", 
            json={"name": name, "description": "Guild for testing emojis"},
            headers={"Authorization": f"Bearer {token}"}
        )
        res.raise_for_status()
        guild = res.json()
        print(f"Guild created: {guild['id']}")
        return guild['id']
    except Exception as e:
        print(f"Failed to create guild: {e}")
        if hasattr(e, 'response') and e.response:
             print(e.response.text)
        sys.exit(1)

def upload_emoji(token, guild_id, name, file_path):
    print(f"Uploading emoji '{name}' from {file_path}...")
    mime_type = mimetypes.guess_type(file_path)[0] or 'application/octet-stream'
    
    try:
        with open(file_path, 'rb') as f:
            files = {
                'file': (os.path.basename(file_path), f, mime_type)
            }
            data = {
                'name': name
            }
            res = requests.post(
                f"{API_URL}/api/guilds/{guild_id}/emojis",
                headers={"Authorization": f"Bearer {token}"},
                files=files,
                data=data
            )
            res.raise_for_status()
            emoji = res.json()
            print(f"Uploaded emoji: {emoji['name']} ({emoji['id']})")
            return emoji
    except Exception as e:
        print(f"Failed to upload emoji: {e}")
        if hasattr(e, 'response') and e.response:
             print(e.response.text)
        return None

def main():
    if len(sys.argv) < 2:
        print("Usage: python3 upload_emojis.py <file_or_directory>")
        print("Example: python3 upload_emojis.py gfx/example/Floki-emojis.png")
        sys.exit(1)

    path = sys.argv[1]
    if not os.path.exists(path):
        print(f"Path not found: {path}")
        sys.exit(1)

    token = get_token()
    guild_id = create_guild(token)
    
    if os.path.isfile(path):
        name = os.path.splitext(os.path.basename(path))[0]
        upload_emoji(token, guild_id, name, path)
    elif os.path.isdir(path):
        for filename in os.listdir(path):
            if filename.lower().endswith(('.png', '.jpg', '.jpeg', '.gif', '.webp')):
                file_path = os.path.join(path, filename)
                name = os.path.splitext(filename)[0]
                upload_emoji(token, guild_id, name, file_path)
    
    print("\nDone. You can list emojis with:")
    print(f"curl -H \"Authorization: Bearer {token}\" {API_URL}/api/guilds/{guild_id}/emojis")

if __name__ == "__main__":
    main()
