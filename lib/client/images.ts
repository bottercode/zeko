const imageFormats: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
}

export const imageAccept = [...new Set(Object.values(imageFormats))].join(',')

function imageType(file: File) {
  const ext = file.name.split('.').at(-1)?.toLowerCase() ?? ''
  return file.type || imageFormats[ext]
}

export function isBoardImage(file: File): boolean {
  return Object.values(imageFormats).some((type) => type === imageType(file))
}

export async function imageSketch(file: File) {
  if (file.size > 8 * 1024 * 1024) throw new Error('Choose an image under 8 MB.')
  const blob = file.type ? file : file.slice(0, file.size, imageType(file))
  const url = URL.createObjectURL(blob)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight))
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(blob)
    })
    return {
      name: file.name.replace(/\.[^.]+$/, '').trim().slice(0, 120) || 'Pasted image',
      w: Math.max(1, Math.round(image.naturalWidth * scale)),
      h: Math.max(1, Math.round(image.naturalHeight * scale)),
      html: `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;height:100vh;background:transparent"><img src="${data}" alt="" style="display:block;width:100%;height:100%;object-fit:contain"></body></html>`,
    }
  } finally {
    URL.revokeObjectURL(url)
  }
}
