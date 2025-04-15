![How Dubbing Works](./assets/How-dubbing-works.png)

# Dubbing Engine with Bun and Typescript

[![Star this repo](https://img.shields.io/github/stars/kevinrss01/dubbing-engine?style=social)](https://github.com/kevinrss01/dubbing-engine)

## 🌐 Demo

### Original video

https://github.com/user-attachments/assets/73a22695-9457-4c10-8782-c663dae249f3

### Translated video

https://github.com/user-attachments/assets/a7b07820-a99c-4c95-80f6-e2c76f8d191b

This AI-powered translation and video dubbing engine can translate audio and video files while cloning the original voices, adding subtitles, and synchronizing lip movements. The engine powers [VoiceCheap.ai](https://voicecheap.ai).

## ✨ Features

- Voice cloning & generation
- Automatic language detection
- Speech adaptation for natural timing (SmartSync)
- Background audio separation
- Subtitle generation
- Lip synchronization
- Supports 35 languages

## 🧠 How It Works

The dubbing process follows these steps:

1. **Configuration**: Select target language and options
2. **Transcription & Analysis**:
   - Identify source language
   - Transcribe audio
   - Generate context summary
   - Perform speaker diarization (identify different speakers)
   
3. **Translation**:
   - Format speech segments
   - Translate with LLM contextual awareness
   
4. **Audio Processing**:
   - Separate voices and background audio
   - Measure audio levels
   - Create timeline for each speaker
   
5. **Voice Generation**:
   - Clone each speaker's voice
   - Apply SmartSync adaptation to match timing
   - Adjust speed if necessary
   
6. **Final Assembly**:
   - Concatenate translated segments
   - Adjust audio levels and equalize
   - Merge translated voices with background audio
   - Add subtitles
   - Apply lip synchronization

### SmartSync Adaptation

SmartSync adapts the speaker's speech based on language and speaking speed to match the original timing as closely as possible. When a literal translation would run too long, it intelligently reformulates sentences to maintain natural pacing and synchronization with the original speech.

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/)
- [Bun](https://bun.sh/) (JavaScript runtime & toolkit)
- [FFmpeg](https://ffmpeg.org/download.html)
- API keys for various services

### API Keys Required

Create a `.env` file based on the `.env.example`:

```
PORT=4000
OPENAI_API_KEY=your_openai_api_key_here
GLADIA_API_KEY=your_gladia_api_key_here
ELEVEN_LABS_API_KEY=your_eleven_labs_api_key_here
LALAL_LICENSE_KEY=your_lalal_license_key_here
SYNC_LAB_API_KEY=your_sync_lab_api_key_here

#AWS (For lipsync)
AWS_S3_REGION=your_aws_s3_region_here
AWS_ACCESS_KEY_ID=your_aws_access_key_id_here
AWS_SECRET_ACCESS_KEY=your_aws_secret_access_key_here
AWS_BUCKET_NAME=your_aws_bucket_name_here
```

> **Note**: AWS credentials are only required for the lipsync feature. Users need a "Scale" subscription for SyncLab to add lipsync to videos longer than 5 minutes.

### Installation & Usage

1. Clone the repository
2. Create and configure your `.env` file with the necessary API keys
3. Run the start script:

```bash
./start.sh
```

The script will:
- Check for required dependencies
- Verify environment variables
- Install necessary packages
- Guide you through the dubbing process

## 🛠️ Technology

- **TypeScript**: Core programming language
- **Bun**: JavaScript runtime and toolkit
- **OpenAI**: Translation and text adaptation
- **Gladia**: Audio transcription
- **Eleven Labs**: Voice cloning and speech generation
- **Lalal.ai**: Audio separation
- **SyncLab**: Lip synchronization

## 🔤 Supported Languages

The engine supports all these languages:

| Flag | Language | Flag | Language |
|------|----------|------|----------|
| 🇸🇪 | Swedish | 🇫🇷 | French |
| 🇰🇷 | Korean | 🇲🇾 | Malay |
| 🇺🇦 | Ukrainian | 🇮🇹 | Italian |
| 🇬🇷 | Greek | 🇷🇴 | Romanian |
| 🇯🇵 | Japanese | 🇨🇳 | Mandarin |
| 🇺🇸 | English | 🇮🇳 | Tamil |
| 🇺🇸 | American English | 🇹🇷 | Turkish |
| 🇷🇺 | Russian | 🇮🇩 | Indonesian |
| 🇮🇳 | Hindi | 🇵🇭 | Tagalog |
| 🇩🇪 | German | 🇸🇦 | Arabic |
| 🇩🇰 | Danish | 🇳🇴 | Norwegian |
| 🇧🇬 | Bulgarian | 🇻🇳 | Vietnamese |
| 🇨🇿 | Czech | 🇭🇺 | Hungarian |
| 🇵🇱 | Polish | 🇬🇧 | British English |
| 🇸🇰 | Slovak | 🇨🇦 | French Canadian |
| 🇫🇮 | Finnish | 🇭🇷 | Croatian |
| 🇪🇸 | Spanish | 🇳🇱 | Dutch |
| 🇵🇹 | Portuguese |  |  |

## 🤝 Contributing

Contributions are welcome! Feel free to:
- Star this repository to show support
- Open issues for bugs or feature requests
- Submit pull requests to improve the codebase

## ⚠️ Requirements

For optimal performance and to use all features:
- Ensure FFmpeg is properly installed
- Configure all API keys
- For lipsync features, AWS S3 credentials are required
- SyncLab "Scale" subscription for longer videos

## 📄 License

N/A

---

If you find this project helpful, please consider giving it a ⭐ to show support!
