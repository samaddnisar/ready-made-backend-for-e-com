import type { FeatureKey, Resource } from "@repo/core";
import {
  BadgePercent,
  BookOpen,
  Boxes,
  ClipboardList,
  FolderTree,
  Gift,
  Heart,
  Image,
  Layers,
  LayoutDashboard,
  Mail,
  Package,
  Settings,
  ShoppingCart,
  Sparkles,
  Star,
  Truck,
  UserCog,
  Users,
  Receipt,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  title: string;
  href: string;
  icon: LucideIcon;
  /** RBAC resource — hidden unless the role can `read` it. */
  resource: Resource;
  /** When set, hidden unless the feature flag is on. */
  feature?: FeatureKey;
};

export type NavSection = { label: string; items: NavItem[] };

export const NAV_SECTIONS: NavSection[] = [
  {
    label: "Overview",
    items: [{ title: "Dashboard", href: "/dashboard", icon: LayoutDashboard, resource: "dashboard" }],
  },
  {
    label: "Catalog",
    items: [
      { title: "Products", href: "/products", icon: Package, resource: "products" },
      { title: "Categories", href: "/categories", icon: FolderTree, resource: "products" },
      { title: "Collections", href: "/collections", icon: Layers, resource: "products" },
      { title: "Inventory", href: "/inventory", icon: Boxes, resource: "inventory" },
      { title: "Media", href: "/media", icon: Image, resource: "media" },
    ],
  },
  {
    label: "Sales",
    items: [
      { title: "Orders", href: "/orders", icon: ShoppingCart, resource: "orders" },
      { title: "Customers", href: "/customers", icon: Users, resource: "customers" },
      { title: "Discounts", href: "/discounts", icon: BadgePercent, resource: "discounts" },
    ],
  },
  {
    label: "Modules",
    items: [
      { title: "Reviews", href: "/reviews", icon: Star, resource: "reviews", feature: "reviews" },
      { title: "Wishlists", href: "/wishlists", icon: Heart, resource: "wishlists", feature: "wishlists" },
      { title: "Gift cards", href: "/gift-cards", icon: Gift, resource: "gift_cards", feature: "gift_cards" },
      { title: "Loyalty", href: "/loyalty", icon: Sparkles, resource: "loyalty", feature: "loyalty" },
      { title: "Blog / CMS", href: "/content", icon: BookOpen, resource: "cms", feature: "cms" },
      {
        title: "Abandoned carts",
        href: "/abandoned-carts",
        icon: ShoppingCart,
        resource: "abandoned_carts",
        feature: "abandoned_cart",
      },
      { title: "Newsletter", href: "/newsletter", icon: Mail, resource: "newsletter", feature: "newsletter" },
    ],
  },
  {
    label: "Store",
    items: [
      { title: "Shipping", href: "/shipping", icon: Truck, resource: "shipping" },
      { title: "Tax", href: "/tax", icon: Receipt, resource: "tax" },
      { title: "Settings", href: "/settings", icon: Settings, resource: "settings" },
      { title: "Users & roles", href: "/users", icon: UserCog, resource: "users" },
      { title: "Audit log", href: "/audit-log", icon: ClipboardList, resource: "audit_log" },
    ],
  },
];
