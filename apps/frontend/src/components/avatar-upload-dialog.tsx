'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Cropper from 'react-easy-crop';
import type { Area } from 'react-easy-crop';
import { Loader2, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

import { apiFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

interface AvatarUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: number;
  currentAvatar?: string | null;
  onSuccess: () => void;
}

/**
 * Extracts the cropped region from the source image, draws it at 400x400,
 * and returns a JPEG blob. Server-side sharp handles final 200x200 resize.
 */
function getCroppedImage(imageSrc: string, crop: Area): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 400;
      canvas.height = 400;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas not supported'));
        return;
      }
      ctx.drawImage(
        image,
        crop.x,
        crop.y,
        crop.width,
        crop.height,
        0,
        0,
        400,
        400,
      );
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Failed to create blob'));
        },
        'image/jpeg',
        0.9,
      );
    };
    image.onerror = () => reject(new Error('Failed to load image'));
    image.src = imageSrc;
  });
}

export function AvatarUploadDialog({
  open,
  onOpenChange,
  userId,
  currentAvatar,
  onSuccess,
}: AvatarUploadDialogProps) {
  const tCommon = useTranslations('common');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (!open) {
      setImageSrc(null);
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setCroppedAreaPixels(null);
      setUploading(false);
      setRemoving(false);
    }
  }, [open]);

  const onFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setImageSrc(reader.result as string);
    };
    reader.readAsDataURL(file);
    // Reset input value so the same file can be re-selected
    e.target.value = '';
  }, []);

  const onCropComplete = useCallback((_: Area, croppedPixels: Area) => {
    setCroppedAreaPixels(croppedPixels);
  }, []);

  const handleSave = useCallback(async () => {
    if (!imageSrc || !croppedAreaPixels) return;
    setUploading(true);
    try {
      const blob = await getCroppedImage(imageSrc, croppedAreaPixels);
      const formData = new FormData();
      formData.append('file', blob, 'avatar.jpg');
      const res = await fetch(`${API_BASE}/users/${userId}/avatar`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as Record<string, string>).error ?? `Upload failed: ${res.status}`,
        );
      }
      toast.success(tCommon('save'));
      onSuccess();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tCommon('error'));
    } finally {
      setUploading(false);
    }
  }, [imageSrc, croppedAreaPixels, userId, onSuccess, onOpenChange, tCommon]);

  const handleRemove = useCallback(async () => {
    setRemoving(true);
    try {
      await apiFetch(`/users/${userId}/avatar`, { method: 'DELETE' });
      onSuccess();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tCommon('error'));
    } finally {
      setRemoving(false);
    }
  }, [userId, onSuccess, onOpenChange, tCommon]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Avatar</DialogTitle>
        </DialogHeader>

        {/* Cropper area */}
        {imageSrc ? (
          <div className="flex flex-col gap-3">
            <div className="relative h-64 w-full overflow-hidden rounded-lg bg-muted">
              <Cropper
                image={imageSrc}
                crop={crop}
                onCropChange={setCrop}
                zoom={zoom}
                onZoomChange={setZoom}
                onCropComplete={onCropComplete}
                aspect={1}
                cropShape="round"
                showGrid={false}
              />
            </div>
            {/* Zoom slider */}
            <div className="flex items-center gap-3 px-1">
              <span className="text-xs text-muted-foreground">Zoom</span>
              <input
                type="range"
                min={1}
                max={3}
                step={0.1}
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-wpt-teal"
              />
            </div>
          </div>
        ) : (
          <div className="flex h-48 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border">
            <Upload className="size-8 text-muted-foreground" />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
            >
              Choose photo
            </Button>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png"
          className="hidden"
          onChange={onFileSelect}
        />

        <DialogFooter>
          {currentAvatar ? (
            <Button
              type="button"
              variant="outline"
              className="text-destructive hover:bg-destructive/10"
              onClick={handleRemove}
              disabled={uploading || removing}
            >
              {removing ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
              Remove
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={uploading || removing}
          >
            {tCommon('cancel')}
          </Button>
          {imageSrc ? (
            <Button
              type="button"
              onClick={handleSave}
              disabled={uploading || !croppedAreaPixels}
            >
              {uploading ? <Loader2 className="size-4 animate-spin" /> : null}
              {tCommon('save')}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
