"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type VariantRow = {
  /** Stable React key for the row (not sent to the API). */
  key: string;
  /** Present for variants that already exist on the server. */
  id?: string;
  sku: string;
  /** Dollars, as typed (converted to integer cents on save). */
  price: string;
  compareAtPrice: string;
  weightGrams: string;
  barcode: string;
  optionValues: Record<string, string>;
};

function emptyRow(): VariantRow {
  return {
    key: crypto.randomUUID(),
    sku: "",
    price: "",
    compareAtPrice: "",
    weightGrams: "",
    barcode: "",
    optionValues: {},
  };
}

export function VariantEditor({
  optionNames,
  onOptionNamesChange,
  variants,
  onVariantsChange,
  currency,
  disabled,
}: {
  optionNames: string[];
  onOptionNamesChange: (names: string[]) => void;
  variants: VariantRow[];
  onVariantsChange: (variants: VariantRow[]) => void;
  currency: string;
  disabled: boolean;
}) {
  const [newOption, setNewOption] = useState("");

  function addOption() {
    const name = newOption.trim().slice(0, 50);
    if (!name) return;
    if (optionNames.some((existing) => existing.toLowerCase() === name.toLowerCase())) {
      setNewOption("");
      return;
    }
    onOptionNamesChange([...optionNames, name]);
    setNewOption("");
  }

  function removeOption(name: string) {
    onOptionNamesChange(optionNames.filter((existing) => existing !== name));
    onVariantsChange(
      variants.map((variant) => {
        const { [name]: _removed, ...rest } = variant.optionValues;
        return { ...variant, optionValues: rest };
      }),
    );
  }

  function updateRow(index: number, patch: Partial<VariantRow>) {
    onVariantsChange(
      variants.map((variant, i) => (i === index ? { ...variant, ...patch } : variant)),
    );
  }

  function moveRow(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= variants.length) return;
    const next = [...variants];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved!);
    onVariantsChange(next);
  }

  function removeRow(index: number) {
    if (variants.length <= 1) return; // at least one variant, always
    onVariantsChange(variants.filter((_, i) => i !== index));
  }

  function rowTitle(variant: VariantRow, index: number): string {
    if (optionNames.length === 0) return index === 0 && variants.length === 1 ? "Default variant" : `Variant ${index + 1}`;
    const composed = optionNames
      .map((name) => (variant.optionValues[name] ?? "").trim())
      .filter(Boolean)
      .join(" / ");
    return composed || `Variant ${index + 1}`;
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="new-option-name">Options</Label>
        <div className="flex flex-wrap items-center gap-2">
          {optionNames.map((name) => (
            <Badge key={name} variant="secondary" className="gap-1">
              {name}
              <button
                type="button"
                onClick={() => removeOption(name)}
                disabled={disabled}
                aria-label={`Remove option ${name}`}
                className="disabled:pointer-events-none disabled:opacity-50"
              >
                <X className="size-3" aria-hidden />
              </button>
            </Badge>
          ))}
          <Input
            id="new-option-name"
            value={newOption}
            onChange={(e) => setNewOption(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addOption();
              }
            }}
            placeholder="e.g. Size, Color"
            className="h-8 w-40"
            disabled={disabled}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addOption}
            disabled={disabled || !newOption.trim()}
          >
            Add option
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Each option adds a field to every variant; the variant title is composed from its option
          values (e.g. “M / Black”).
        </p>
      </div>

      <div className="space-y-3">
        {variants.map((variant, i) => (
          <div key={variant.key} className="space-y-3 rounded-lg border p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">{rowTitle(variant, i)}</p>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => moveRow(i, -1)}
                  disabled={disabled || i === 0}
                  aria-label="Move variant up"
                >
                  <ArrowUp className="size-4" aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => moveRow(i, 1)}
                  disabled={disabled || i === variants.length - 1}
                  aria-label="Move variant down"
                >
                  <ArrowDown className="size-4" aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => removeRow(i)}
                  disabled={disabled || variants.length <= 1}
                  aria-label="Remove variant"
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </div>
            </div>

            {optionNames.length > 0 ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {optionNames.map((name) => (
                  <div key={name} className="space-y-1">
                    <Label htmlFor={`variant-${variant.key}-${name}`} className="text-xs">
                      {name}
                    </Label>
                    <Input
                      id={`variant-${variant.key}-${name}`}
                      value={variant.optionValues[name] ?? ""}
                      onChange={(e) =>
                        updateRow(i, {
                          optionValues: { ...variant.optionValues, [name]: e.target.value },
                        })
                      }
                      disabled={disabled}
                    />
                  </div>
                ))}
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <div className="space-y-1">
                <Label htmlFor={`variant-${variant.key}-sku`} className="text-xs">
                  SKU
                </Label>
                <Input
                  id={`variant-${variant.key}-sku`}
                  value={variant.sku}
                  onChange={(e) => updateRow(i, { sku: e.target.value })}
                  disabled={disabled}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`variant-${variant.key}-price`} className="text-xs">
                  Price ({currency})
                </Label>
                <Input
                  id={`variant-${variant.key}-price`}
                  type="number"
                  min={0}
                  step={0.01}
                  value={variant.price}
                  onChange={(e) => updateRow(i, { price: e.target.value })}
                  disabled={disabled}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`variant-${variant.key}-compare`} className="text-xs">
                  Compare-at ({currency})
                </Label>
                <Input
                  id={`variant-${variant.key}-compare`}
                  type="number"
                  min={0}
                  step={0.01}
                  value={variant.compareAtPrice}
                  onChange={(e) => updateRow(i, { compareAtPrice: e.target.value })}
                  disabled={disabled}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`variant-${variant.key}-weight`} className="text-xs">
                  Weight (g)
                </Label>
                <Input
                  id={`variant-${variant.key}-weight`}
                  type="number"
                  min={0}
                  step={1}
                  value={variant.weightGrams}
                  onChange={(e) => updateRow(i, { weightGrams: e.target.value })}
                  disabled={disabled}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`variant-${variant.key}-barcode`} className="text-xs">
                  Barcode
                </Label>
                <Input
                  id={`variant-${variant.key}-barcode`}
                  value={variant.barcode}
                  onChange={(e) => updateRow(i, { barcode: e.target.value })}
                  disabled={disabled}
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onVariantsChange([...variants, emptyRow()])}
        disabled={disabled}
      >
        <Plus className="size-4" aria-hidden />
        Add variant
      </Button>
    </div>
  );
}
