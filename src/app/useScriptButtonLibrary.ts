import { useEffect, useState } from "react";
import { askConfirm } from "./confirmDialog";
import {
  createScriptButtonId,
  createScriptCategoryId,
  normalizeScriptButtonLibrary,
} from "./scriptButtonModel";
import type { ScriptButton, ScriptButtonCategory } from "./scriptButtonModel";

/** Stable empty list, so effects depending on the active buttons do not re-run every render. */
const noButtons: ScriptButton[] = [];

/**
 * The script button library: loaded from the encrypted store once Shellium is unlocked, saved back on
 * every change, plus the selection shared by the script bar and the button manager.
 */
export function useScriptButtonLibrary(canUseSecureData: boolean, storageRevision: number) {
  const [categories, setCategories] = useState<ScriptButtonCategory[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [selectedButtonId, setSelectedButtonId] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedCategory = categories.find((category) => category.id === selectedCategoryId) ?? categories[0] ?? null;
  const activeButtons = selectedCategory?.buttons ?? noButtons;
  const selectedButton = activeButtons.find((button) => button.id === selectedButtonId) ?? null;

  useEffect(() => {
    if (!canUseSecureData) {
      setIsLoaded(false);
      return;
    }

    let isMounted = true;
    setIsLoaded(false);

    window.shellium?.scriptButtons.list()
      .then((library) => {
        if (!isMounted) {
          return;
        }

        const normalizedLibrary = normalizeScriptButtonLibrary(library);
        setCategories(normalizedLibrary.categories);
        setSelectedCategoryId((current) => (
          normalizedLibrary.categories.some((category) => category.id === current)
            ? current
            : normalizedLibrary.categories[0]?.id ?? null
        ));
        setIsLoaded(true);
        setError(null);
      })
      .catch((loadError: unknown) => {
        if (!isMounted) {
          return;
        }

        const fallback = normalizeScriptButtonLibrary(null).categories;
        setCategories(fallback);
        setSelectedCategoryId(fallback[0]?.id ?? null);
        setIsLoaded(true);
        setError(loadError instanceof Error ? loadError.message : "Script buttons could not be loaded.");
      });

    return () => {
      isMounted = false;
    };
  }, [canUseSecureData, storageRevision]);

  useEffect(() => {
    if (!isLoaded || !canUseSecureData) {
      return;
    }

    const library = normalizeScriptButtonLibrary({ categories });
    window.shellium?.scriptButtons.save(library).catch((saveError: unknown) => {
      setError(saveError instanceof Error ? saveError.message : "Script buttons could not be saved.");
    });
  }, [canUseSecureData, isLoaded, categories]);

  useEffect(() => {
    if (selectedButtonId && !activeButtons.some((button) => button.id === selectedButtonId)) {
      setSelectedButtonId(null);
    }
  }, [activeButtons, selectedButtonId]);

  const updateCategory = (categoryId: string, updater: (category: ScriptButtonCategory) => ScriptButtonCategory) => {
    setCategories((current) => current.map((category) => (
      category.id === categoryId ? updater(category) : category
    )));
  };

  const addCategory = (name: string) => {
    const id = createScriptCategoryId();
    setCategories((current) => [
      ...current,
      { id, name, sortOrder: current.length, buttons: [] },
    ]);
    setSelectedCategoryId(id);
    setSelectedButtonId(null);
  };

  const renameCategory = (categoryId: string, name: string) => {
    updateCategory(categoryId, (category) => ({ ...category, name }));
  };

  const deleteCategory = async (categoryId: string) => {
    const category = categories.find((item) => item.id === categoryId);
    const buttonCount = category?.buttons.length ?? 0;

    const confirmed = await askConfirm({
      title: "Delete category",
      body: `Delete the script category "${category?.name ?? "this category"}"${buttonCount > 0 ? ` and its ${buttonCount} button${buttonCount === 1 ? "" : "s"}` : ""}?`,
      confirmLabel: "Delete category",
      tone: "danger",
    });
    if (!confirmed) {
      return;
    }

    setCategories((current) => {
      const remainingCategories = current.filter((item) => item.id !== categoryId);
      const nextCategories = remainingCategories.length > 0
        ? remainingCategories
        : [{ id: "default", name: "Default", sortOrder: 0, buttons: [] }];

      setSelectedCategoryId(nextCategories[0]?.id ?? null);
      setSelectedButtonId(null);
      return nextCategories.map((item, index) => ({ ...item, sortOrder: index }));
    });
  };

  const addButton = (categoryId: string, fields: Pick<ScriptButton, "label" | "script" | "color" | "showTooltip">) => {
    const id = createScriptButtonId();

    updateCategory(categoryId, (category) => ({
      ...category,
      buttons: [
        ...category.buttons,
        { id, categoryId, ...fields, sortOrder: category.buttons.length },
      ],
    }));
    setSelectedButtonId(id);
  };

  const updateButton = (buttonId: string, fields: Partial<ScriptButton>) => {
    setCategories((current) => current.map((category) => ({
      ...category,
      buttons: category.buttons.map((button) => (
        button.id === buttonId
          ? {
              ...button,
              ...fields,
              label: fields.label !== undefined ? fields.label : button.label,
              script: fields.script !== undefined ? fields.script : button.script,
              color: fields.color !== undefined ? fields.color : button.color,
            }
          : button
      )),
    })));
  };

  /** Asks first; false when the user kept the button. */
  const deleteButton = async (buttonId: string) => {
    const button = categories
      .flatMap((category) => category.buttons)
      .find((item) => item.id === buttonId);

    const confirmed = await askConfirm({
      title: "Delete script button",
      body: `Delete the script button "${button?.label ?? "this button"}"?`,
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!confirmed) {
      return false;
    }

    setCategories((current) => current.map((category) => ({
      ...category,
      buttons: category.buttons
        .filter((item) => item.id !== buttonId)
        .map((item, index) => ({ ...item, sortOrder: index })),
    })));
    setSelectedButtonId((current) => (current === buttonId ? null : current));
    return true;
  };

  const moveButtonToIndex = (buttonId: string, targetIndex: (buttonIndex: number) => number) => {
    setCategories((current) => current.map((category) => {
      const buttonIndex = category.buttons.findIndex((button) => button.id === buttonId);
      const nextIndex = buttonIndex < 0 ? -1 : targetIndex(buttonIndex);

      if (buttonIndex < 0 || nextIndex < 0 || nextIndex >= category.buttons.length || nextIndex === buttonIndex) {
        return category;
      }

      const buttons = [...category.buttons];
      const [button] = buttons.splice(buttonIndex, 1);
      buttons.splice(nextIndex, 0, button);

      return {
        ...category,
        buttons: buttons.map((nextButton, index) => ({ ...nextButton, sortOrder: index })),
      };
    }));
  };

  const moveButton = (buttonId: string, direction: -1 | 1) => moveButtonToIndex(buttonId, (index) => index + direction);

  const moveButtonTo = (buttonId: string, targetIndex: number) => moveButtonToIndex(buttonId, () => targetIndex);

  return {
    categories,
    selectedCategory,
    setSelectedCategoryId,
    activeButtons,
    selectedButton,
    setSelectedButtonId,
    error,
    addCategory,
    renameCategory,
    deleteCategory,
    addButton,
    updateButton,
    deleteButton,
    moveButton,
    moveButtonTo,
  };
}

export type ScriptButtonLibraryState = ReturnType<typeof useScriptButtonLibrary>;
