'use client';

import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { AudioRecorder } from '@/components/studio/audio-recorder';
import { AudioUploader } from '@/components/studio/audio-uploader';
import { SongPreview } from '@/components/studio/song-preview';
import { useToast } from '@/hooks/use-toast';
import { useSongGeneration } from '@/hooks/use-song-generation';
import {
  Mic,
  Upload,
  Music,
  Play,
  Download,
  Share2,
  Sparkles,
  Loader2,
} from 'lucide-react';

const songSchema = z.object({
  lyrics: z.string().min(10, 'Lyrics must be at least 10 characters').optional(),
  genre: z.enum([
    'POP', 'RAP', 'ROCK', 'EDM', 'ARABIC',
    'KHALEEJI', 'YEMENI', 'LOFI', 'CINEMATIC', 'ACOUSTIC',
  ]),
  mood: z.enum(['HAPPY', 'SAD', 'EPIC', 'ROMANTIC', 'EMOTIONAL', 'MOTIVATIONAL']),
  language: z.enum(['ARABIC', 'ENGLISH']),
  duration: z.number().min(30).max(180),
  voiceType: z.enum(['MALE', 'FEMALE']),
});

type SongFormData = z.infer<typeof songSchema>;

export default function AIStudioPage() {
  const [inputMode, setInputMode] = useState<'text' | 'record' | 'upload'>('text');
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const { generate, isGenerating, progress, song } = useSongGeneration();
  const { toast } = useToast();

  const form = useForm<SongFormData>({
    resolver: zodResolver(songSchema),
    defaultValues: {
      genre: 'POP',
      mood: 'HAPPY',
      language: 'ENGLISH',
      duration: 60,
      voiceType: 'MALE',
    },
  });

  const onSubmit = async (data: SongFormData) => {
    try {
      await generate({
        ...data,
        audio: audioBlob,
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to generate song. Please try again.',
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-12"
      >
        <h1 className="text-5xl font-bold mb-4 bg-gradient-to-r from-purple-400 to-blue-500 bg-clip-text text-transparent">
          AI Music Studio
        </h1>
        <p className="text-xl text-gray-400">
          Create professional songs from your words or voice
        </p>
      </motion.div>

      <div className="grid lg:grid-cols-2 gap-8">
        {/* Input Section */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="space-y-6"
        >
          {/* Input Mode Selection */}
          <Card className="p-6 bg-gradient-to-br from-gray-900 to-black border-purple-500/20">
            <div className="flex gap-2 mb-6">
              {[
                { value: 'text', label: 'Lyrics', icon: Music },
                { value: 'record', label: 'Record', icon: Mic },
                { value: 'upload', label: 'Upload', icon: Upload },
              ].map((mode) => (
                <Button
                  key={mode.value}
                  variant={inputMode === mode.value ? 'default' : 'outline'}
                  onClick={() => setInputMode(mode.value as any)}
                  className={`flex-1 ${
                    inputMode === mode.value
                      ? 'bg-purple-600 hover:bg-purple-700'
                      : 'border-gray-700'
                  }`}
                >
                  <mode.icon className="mr-2 h-4 w-4" />
                  {mode.label}
                </Button>
              ))}
            </div>

            {/* Dynamic Input */}
            {inputMode === 'text' && (
              <Textarea
                placeholder="Enter your lyrics here...&#10;&#10;Example:&#10;In the quiet night, I hear your voice&#10;Echoing through the stars above..."
                className="min-h-[200px] bg-black/50 border-gray-700 text-white placeholder:text-gray-500"
                {...form.register('lyrics')}
              />
            )}

            {inputMode === 'record' && (
              <AudioRecorder
                onRecordingComplete={setAudioBlob}
                maxDuration={180}
              />
            )}

            {inputMode === 'upload' && (
              <AudioUploader
                onFileSelect={setAudioBlob}
                accept="audio/*"
                maxSize={50 * 1024 * 1024} // 50MB
              />
            )}
          </Card>

          {/* Options */}
          <Card className="p-6 bg-gradient-to-br from-gray-900 to-black border-purple-500/20 space-y-6">
            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-purple-400" />
              Song Options
            </h3>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-gray-300">Genre</Label>
                <Select
                  onValueChange={(value) => form.setValue('genre', value as any)}
                  defaultValue={form.getValues('genre')}
                >
                  <SelectTrigger className="bg-black/50 border-gray-700 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="POP">Pop 🎵</SelectItem>
                    <SelectItem value="RAP">Rap 🎤</SelectItem>
                    <SelectItem value="ROCK">Rock 🎸</SelectItem>
                    <SelectItem value="EDM">EDM 🎧</SelectItem>
                    <SelectItem value="ARABIC">Arabic 🎶</SelectItem>
                    <SelectItem value="KHALEEJI">Khaleeji 🏜️</SelectItem>
                    <SelectItem value="YEMENI">Yemeni 🌴</SelectItem>
                    <SelectItem value="LOFI">LoFi 📻</SelectItem>
                    <SelectItem value="CINEMATIC">Cinematic 🎬</SelectItem>
                    <SelectItem value="ACOUSTIC">Acoustic 🎻</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-gray-300">Mood</Label>
                <Select
                  onValueChange={(value) => form.setValue('mood', value as any)}
                  defaultValue={form.getValues('mood')}
                >
                  <SelectTrigger className="bg-black/50 border-gray-700 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="HAPPY">Happy 😊</SelectItem>
                    <SelectItem value="SAD">Sad 😢</SelectItem>
                    <SelectItem value="EPIC">Epic ⚡</SelectItem>
                    <SelectItem value="ROMANTIC">Romantic 💕</SelectItem>
                    <SelectItem value="EMOTIONAL">Emotional 🎭</SelectItem>
                    <SelectItem value="MOTIVATIONAL">Motivational 🔥</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-gray-300">Language</Label>
                <Select
                  onValueChange={(value) => form.setValue('language', value as any)}
                  defaultValue={form.getValues('language')}
                >
                  <SelectTrigger className="bg-black/50 border-gray-700 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ENGLISH">English 🇺🇸</SelectItem>
                    <SelectItem value="ARABIC">العربية 🇸🇦</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-gray-300">Voice</Label>
                <Select
                  onValueChange={(value) => form.setValue('voiceType', value as any)}
                  defaultValue={form.getValues('voiceType')}
                >
                  <SelectTrigger className="bg-black/50 border-gray-700 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MALE">Male 👨</SelectItem>
                    <SelectItem value="FEMALE">Female 👩</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between">
                <Label className="text-gray-300">Duration</Label>
                <span className="text-purple-400 font-semibold">
                  {form.watch('duration')}s
                </span>
              </div>
              <Slider
                min={30}
                max={180}
                step={30}
                value={[form.watch('duration')]}
                onValueChange={([value]) => form.setValue('duration', value)}
                className="cursor-pointer"
              />
              <div className="flex justify-between text-xs text-gray-500">
                <span>30s</span>
                <span>60s</span>
                <span>120s</span>
                <span>180s</span>
              </div>
            </div>

            <Button
              onClick={form.handleSubmit(onSubmit)}
              disabled={isGenerating}
              className="w-full bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white font-bold py-6 text-lg rounded-xl shadow-lg shadow-purple-500/25"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Generating... {progress}%
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-5 w-5" />
                  Generate Song
                </>
              )}
            </Button>
          </Card>
        </motion.div>

        {/* Preview Section */}
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          className="space-y-6"
        >
          {isGenerating && (
            <Card className="p-6 bg-gradient-to-br from-gray-900 to-black border-purple-500/20">
              <h3 className="text-lg font-semibold text-white mb-4">
                Generating Your Song
              </h3>
              <Progress value={progress} className="h-2 mb-4" />
              <p className="text-gray-400 text-sm text-center">
                {progress < 25 && 'Enhancing lyrics...'}
                {progress >= 25 && progress < 50 && 'Composing melody...'}
                {progress >= 50 && progress < 75 && 'Generating music...'}
                {progress >= 75 && progress < 90 && 'Synthesizing voice...'}
                {progress >= 90 && 'Mastering audio...'}
              </p>
            </Card>
          )}

          {song && !isGenerating && (
            <SongPreview
              song={song}
              onDownload={() => {}}
              onShare={() => {}}
            />
          )}

          {!song && !isGenerating && (
            <Card className="p-12 bg-gradient-to-br from-gray-900 to-black border-purple-500/20 flex flex-col items-center justify-center text-center">
              <Music className="h-20 w-20 text-gray-700 mb-4" />
              <h3 className="text-xl font-semibold text-gray-400 mb-2">
                Your Song Will Appear Here
              </h3>
              <p className="text-gray-600 max-w-md">
                Enter your lyrics or record your voice, choose your preferences,
                and let AI create magic!
              </p>
            </Card>
          )}
        </motion.div>
      </div>
    </div>
  );
}
