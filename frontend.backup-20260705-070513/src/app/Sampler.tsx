import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Button,
  Checkbox,
  Input,
  Label,
  OGDialog,
  OGDialogContent,
  OGDialogHeader,
  OGDialogTitle,
  OGDialogTrigger,
  Skeleton,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  TextareaAutosize,
  ThemeSelector,
  TooltipAnchor,
  useToast,
} from '@librechat/client';

/**
 * FE-0 gate page: renders the core vendored primitives so both themes can be
 * verified against upstream. Not part of the product — removed at FE-6.
 */
export default function Sampler() {
  const { showToast } = useToast();
  const [checked, setChecked] = useState(true);

  return (
    <div className="min-h-dvh w-full bg-surface-primary p-8 text-text-primary">
      <div className="mx-auto flex max-w-2xl flex-col gap-8">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Primitives sampler</h1>
            <Link to="/" className="text-sm text-text-tertiary underline">
              back to shell
            </Link>
          </div>
          <ThemeSelector returnThemeOnly />
        </header>

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-text-secondary">Button</h2>
          <div className="flex flex-wrap items-center gap-2">
            <Button>default</Button>
            <Button variant="destructive">destructive</Button>
            <Button variant="outline">outline</Button>
            <Button variant="secondary">secondary</Button>
            <Button variant="ghost">ghost</Button>
            <Button variant="link">link</Button>
            <Button variant="submit">submit</Button>
            <Button size="sm">sm</Button>
            <Button size="lg">lg</Button>
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-text-secondary">Dialog / Toast / Tooltip</h2>
          <div className="flex flex-wrap items-center gap-2">
            <OGDialog>
              <OGDialogTrigger asChild>
                <Button variant="outline">open dialog</Button>
              </OGDialogTrigger>
              <OGDialogContent className="w-11/12 max-w-md">
                <OGDialogHeader>
                  <OGDialogTitle>Vendored dialog</OGDialogTitle>
                </OGDialogHeader>
                <p className="text-text-secondary">Body text inside the cloned dialog.</p>
              </OGDialogContent>
            </OGDialog>
            <Button
              variant="outline"
              onClick={() => showToast({ message: 'Vendored toast works' })}
            >
              show toast
            </Button>
            <TooltipAnchor description="Vendored tooltip" side="top">
              <Button variant="ghost">hover me</Button>
            </TooltipAnchor>
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-text-secondary">Form controls</h2>
          <div className="flex flex-wrap items-center gap-4">
            <Switch aria-label="Sampler switch" checked={checked} onCheckedChange={setChecked} />
            <Checkbox
              aria-label="Sampler checkbox"
              checked={checked}
              onCheckedChange={(v) => setChecked(v === true)}
            />
            <div className="flex items-center gap-2">
              <Label htmlFor="sampler-input">Label</Label>
              <Input id="sampler-input" placeholder="Input" className="w-48" />
            </div>
          </div>
          <TextareaAutosize
            aria-label="Sampler textarea"
            minRows={2}
            placeholder="TextareaAutosize — grows as you type"
            className="w-full rounded-xl border border-border-light bg-surface-primary p-3 text-text-primary placeholder:text-text-secondary"
          />
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-text-secondary">Tabs / Skeleton</h2>
          <Tabs defaultValue="one">
            <TabsList>
              <TabsTrigger value="one">One</TabsTrigger>
              <TabsTrigger value="two">Two</TabsTrigger>
            </TabsList>
            <TabsContent value="one" className="pt-2 text-text-secondary">
              First tab content.
            </TabsContent>
            <TabsContent value="two" className="pt-2 text-text-secondary">
              Second tab content.
            </TabsContent>
          </Tabs>
          <div className="flex gap-2">
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-8 w-48" />
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-text-secondary">Type</h2>
          <p className="font-sans">Inter — the quick brown fox jumps over the lazy dog.</p>
          <p className="font-mono text-sm">Roboto Mono — const counselle = true;</p>
        </section>
      </div>
    </div>
  );
}
