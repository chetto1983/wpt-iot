'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import Cropper from 'react-easy-crop';
import type { Area } from 'react-easy-crop';
import { ImagePlus, Loader2, Minus, RotateCcw, Trash2, Upload, ZoomIn } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

import { apiFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

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
  const tAvatar = useTranslations('common.avatar');
  const tUsers = useTranslations('users');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileInputId = useId();
  const zoomInputId = useId();

  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);
  const zoomPercent = Math.round(zoom * 100);

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (!open) {
      setImageSrc(null);
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setCroppedAreaPixels(null);
      setUploading(false);
      setRemoving(false);
      setShowRemoveConfirm(false);
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

  const updateZoom = useCallback((nextZoom: number) => {
    setZoom(Math.min(3, Math.max(1, Number(nextZoom.toFixed(1)))));
  }, []);

  const resetEditor = useCallback(() => {
    setCrop({ x: 0, y: 0 });
    setZoom(1);
  }, []);

  const handleSave = useCallback(async () => {
    if (!imageSrc || !croppedAreaPixels) return;
    setUploading(true);
    try {
      const blob = await getCroppedImage(imageSrc, croppedAreaPixels);
      const formData = new FormData();
      formData.append('file', blob, 'avatar.jpg');
      const res = await fetch(`${API_BASE}/api/users/${userId}/avatar`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      if (!res.ok) {
        const body: unknown = await res.json().catch(() => ({}));
        throw new Error(
          (body as Record<string, string>).error ?? `Upload failed: ${res.status}`,
        );
      }
      toast.success(tAvatar('uploadSuccess'));
      onSuccess();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tCommon('error'));
    } finally {
      setUploading(false);
    }
  }, [imageSrc, croppedAreaPixels, userId, onSuccess, onOpenChange, tAvatar, tCommon]);

  const handleRemove = useCallback(async () => {
    setRemoving(true);
    try {
      await apiFetch(`/api/users/${userId}/avatar`, { method: 'DELETE' });
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
      <DialogContent className="overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="gap-1 border-b bg-muted/30 px-6 py-5">
          <DialogTitle>{tAvatar('title')}</DialogTitle>
          <DialogDescription>{tAvatar('subtitle')}</DialogDescription>
        </DialogHeader>

        {imageSrc ? (
          <div className="space-y-5 px-6 py-5">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="space-y-1">
                <p className="text-sm font-medium">{tAvatar('adjustTitle')}</p>
                <p className="text-xs text-muted-foreground">{tAvatar('adjustHint')}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading || removing}
                >
                  <ImagePlus className="size-4" />
                  {tAvatar('replacePhoto')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={resetEditor}
                  disabled={uploading || removing}
                >
                  <RotateCcw className="size-4" />
                  {tAvatar('resetZoom')}
                </Button>
              </div>
            </div>

            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_220px]">
              <div className="relative overflow-hidden rounded-2xl border bg-[radial-gradient(circle_at_top,theme(colors.white),theme(colors.muted))] p-3 dark:bg-[radial-gradient(circle_at_top,theme(colors.zinc.800),theme(colors.zinc.950))]">
                <div className="relative h-[320px] overflow-hidden rounded-xl bg-black/50 sm:h-[420px]">
                  <Cropper
                    image={imageSrc}
                    crop={crop}
                    onCropChange={setCrop}
                    zoom={zoom}
                    onZoomChange={updateZoom}
                    onCropComplete={onCropComplete}
                    aspect={1}
                    cropShape="round"
                    showGrid={false}
                  />
                </div>
              </div>

              <div className="flex flex-col justify-between gap-4 rounded-2xl border bg-muted/30 p-4">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor={zoomInputId}
                      className="text-sm font-medium text-foreground"
                    >
                      {tAvatar('zoom')}
                    </label>
                    <span className="rounded-full bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground ring-1 ring-border">
                      {zoomPercent}%
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      aria-label={tAvatar('zoomOut')}
                      onClick={() => updateZoom(zoom - 0.1)}
                      disabled={zoom <= 1 || uploading || removing}
                    >
                      <Minus className="size-4" />
                    </Button>
                    <input
                      id={zoomInputId}
                      type="range"
                      min={1}
                      max={3}
                      step={0.1}
                      value={zoom}
                      onChange={(e) => updateZoom(Number(e.target.value))}
                      className="h-2 w-full cursor-pointer appearance-none rounded-full bg-background accent-wpt-teal"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      aria-label={tAvatar('zoomIn')}
                      onClick={() => updateZoom(zoom + 0.1)}
                      disabled={zoom >= 3 || uploading || removing}
                    >
                      <ZoomIn className="size-4" />
                    </Button>
                  </div>

                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>100%</span>
                    <span>300%</span>
                  </div>
                </div>

                <div className="rounded-xl bg-background/80 p-4 ring-1 ring-border">
                  <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                    {tAvatar('preview')}
                  </p>
                  <div className="mt-3 flex justify-center">
                    <div
                      className="flex size-24 items-center justify-center overflow-hidden rounded-full bg-muted ring-4 ring-background shadow-sm"
                      style={{
                        backgroundImage: `url(${imageSrc})`,
                        backgroundPosition: `${50 - crop.x / 6}% ${50 - crop.y / 6}%`,
                        backgroundSize: `${zoom * 100}%`,
                      }}
                    />
                  </div>
                  <p className="mt-3 text-center text-xs text-muted-foreground">
                    {tAvatar('previewHint')}
                  </p>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="px-6 py-5">
            <button
              type="button"
              className="flex h-72 w-full flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-border bg-muted/20 px-6 text-center transition-colors hover:border-wpt-teal/60 hover:bg-wpt-teal/5"
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="flex size-14 items-center justify-center rounded-full bg-background text-wpt-teal ring-1 ring-border">
                <Upload className="size-7" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium">{tAvatar('choosePhoto')}</p>
                <p className="text-xs text-muted-foreground">{tAvatar('emptyHint')}</p>
              </div>
            </button>
          </div>
        )}

        <input
          id={fileInputId}
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png"
          aria-label={tAvatar('choosePhoto')}
          className="hidden"
          onChange={onFileSelect}
        />

        <DialogFooter className="px-6">
          {currentAvatar ? (
            <Button
              type="button"
              variant="outline"
              className="text-destructive hover:bg-destructive/10"
              onClick={() => setShowRemoveConfirm(true)}
              disabled={uploading || removing}
            >
              {removing ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
              {tAvatar('remove')}
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

      <AlertDialog open={showRemoveConfirm} onOpenChange={setShowRemoveConfirm}>
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>{tUsers('removeAvatar.title')}</AlertDialogTitle>
            <AlertDialogDescription>{tUsers('removeAvatar.description')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tUsers('removeAvatar.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                setShowRemoveConfirm(false);
                void handleRemove();
              }}
            >
              {tUsers('removeAvatar.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
