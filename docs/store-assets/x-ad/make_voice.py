"""ナレーション（macOS の say・Kyoko）を作る。前後の無音を切って 48kHz の wav に: python3 make_voice.py"""
import os, subprocess, imageio_ffmpeg
H = os.path.dirname(os.path.abspath(__file__)); FF = imageio_ffmpeg.get_ffmpeg_exe(); V = os.path.join(H, 'voice')
for line in open(os.path.join(V, 'lines.txt'), encoding='utf-8'):
    if not line.strip(): continue
    vid, rate, text = line.rstrip('\n').split('|', 2)
    aiff = os.path.join(V, vid + '.aiff')
    subprocess.run(['say', '-v', 'Kyoko', '-r', rate, '-o', aiff, text], check=True)
    subprocess.run([FF, '-hide_banner', '-loglevel', 'error', '-y', '-i', aiff, '-af', 'silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse,apad=pad_dur=0.05',
                    '-ac', '1', '-ar', '48000', os.path.join(V, vid + '.wav')], check=True)
print('ok')
