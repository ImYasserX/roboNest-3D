CREATE TABLE `addresses` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`full_name` text NOT NULL,
	`phone` text NOT NULL,
	`zone_id` text,
	`area_id` text,
	`city` text NOT NULL,
	`district` text NOT NULL,
	`address_line` text NOT NULL,
	`landmark` text,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`zone_id`) REFERENCES `delivery_zones`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`area_id`) REFERENCES `delivery_areas`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `addresses_user_idx` ON `addresses` (`user_id`);--> statement-breakpoint
CREATE TABLE `admin_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`admin_id` text NOT NULL,
	`stage` text NOT NULL,
	`expires_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`mfa_attempts` integer DEFAULT 0 NOT NULL,
	`ip_hash` text,
	`user_agent` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`admin_id`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `admin_sessions_admin_idx` ON `admin_sessions` (`admin_id`);--> statement-breakpoint
CREATE TABLE `admin_users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`display_name` text NOT NULL,
	`role` text NOT NULL,
	`password_hash` text NOT NULL,
	`totp_secret_enc` text,
	`totp_enabled` integer DEFAULT false NOT NULL,
	`totp_last_counter` integer,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`failed_login_count` integer DEFAULT 0 NOT NULL,
	`locked_until` integer,
	`last_login_at` integer,
	`password_changed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admin_users_username_uq` ON `admin_users` (`username`);--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_admin_id` text,
	`actor_label` text NOT NULL,
	`action` text NOT NULL,
	`target_type` text,
	`target_id` text,
	`metadata` text,
	`ip_hash` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`actor_admin_id`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `audit_logs_created_idx` ON `audit_logs` (`created_at`);--> statement-breakpoint
CREATE INDEX `audit_logs_actor_idx` ON `audit_logs` (`actor_admin_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_logs_target_idx` ON `audit_logs` (`target_type`,`target_id`);--> statement-breakpoint
CREATE TABLE `cart_items` (
	`id` text PRIMARY KEY NOT NULL,
	`cart_id` text NOT NULL,
	`product_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`options` text DEFAULT '{}' NOT NULL,
	`line_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`cart_id`) REFERENCES `carts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "cart_items_qty_ck" CHECK("cart_items"."quantity" > 0 AND "cart_items"."quantity" <= 100)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cart_items_line_uq` ON `cart_items` (`cart_id`,`line_key`);--> statement-breakpoint
CREATE TABLE `carts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`visitor_hash` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `carts_user_uq` ON `carts` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `carts_visitor_uq` ON `carts` (`visitor_hash`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_id` text,
	`slug` text NOT NULL,
	`name_en` text NOT NULL,
	`name_ar` text NOT NULL,
	`description_en` text DEFAULT '' NOT NULL,
	`description_ar` text DEFAULT '' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_slug_uq` ON `categories` (`slug`);--> statement-breakpoint
CREATE INDEX `categories_parent_idx` ON `categories` (`parent_id`);--> statement-breakpoint
CREATE TABLE `contact_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`phone` text NOT NULL,
	`subject` text NOT NULL,
	`message` text NOT NULL,
	`status` text DEFAULT 'NEW' NOT NULL,
	`locale` text DEFAULT 'ar' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `contact_messages_status_idx` ON `contact_messages` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `custom_print_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`request_number` text NOT NULL,
	`user_id` text,
	`access_token_hash` text NOT NULL,
	`customer_name` text NOT NULL,
	`customer_phone` text NOT NULL,
	`material` text NOT NULL,
	`color` text NOT NULL,
	`scale_percent` integer DEFAULT 100 NOT NULL,
	`quantity` integer NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'SUBMITTED' NOT NULL,
	`quoted_price` integer,
	`production_days` integer,
	`customer_message` text,
	`admin_notes` text,
	`order_id` text,
	`locale` text DEFAULT 'ar' NOT NULL,
	`reviewed_by` text,
	`reviewed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`reviewed_by`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "custom_requests_qty_ck" CHECK("custom_print_requests"."quantity" > 0 AND "custom_print_requests"."quantity" <= 1000),
	CONSTRAINT "custom_requests_price_ck" CHECK("custom_print_requests"."quoted_price" IS NULL OR "custom_print_requests"."quoted_price" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `custom_requests_number_uq` ON `custom_print_requests` (`request_number`);--> statement-breakpoint
CREATE INDEX `custom_requests_status_idx` ON `custom_print_requests` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `custom_requests_user_idx` ON `custom_print_requests` (`user_id`);--> statement-breakpoint
CREATE TABLE `delivery_areas` (
	`id` text PRIMARY KEY NOT NULL,
	`zone_id` text NOT NULL,
	`name_en` text NOT NULL,
	`name_ar` text NOT NULL,
	`fee` integer NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`zone_id`) REFERENCES `delivery_zones`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "delivery_areas_fee_ck" CHECK("delivery_areas"."fee" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `delivery_areas_zone_name_uq` ON `delivery_areas` (`zone_id`,`name_en`);--> statement-breakpoint
CREATE TABLE `delivery_zones` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name_en` text NOT NULL,
	`name_ar` text NOT NULL,
	`fee` integer NOT NULL,
	`eta_days_min` integer DEFAULT 1 NOT NULL,
	`eta_days_max` integer DEFAULT 3 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "delivery_zones_fee_ck" CHECK("delivery_zones"."fee" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `delivery_zones_code_uq` ON `delivery_zones` (`code`);--> statement-breakpoint
CREATE TABLE `digital_files` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`r2_key` text NOT NULL,
	`filename` text NOT NULL,
	`format` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`uploaded_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`uploaded_by`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `digital_files_product_idx` ON `digital_files` (`product_id`);--> statement-breakpoint
CREATE TABLE `discounts` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`type` text NOT NULL,
	`value` integer NOT NULL,
	`min_subtotal` integer DEFAULT 0 NOT NULL,
	`max_discount` integer,
	`max_uses` integer,
	`used_count` integer DEFAULT 0 NOT NULL,
	`starts_at` integer,
	`ends_at` integer,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "discounts_value_ck" CHECK("discounts"."value" > 0 AND ("discounts"."type" <> 'PERCENT' OR "discounts"."value" <= 100)),
	CONSTRAINT "discounts_uses_ck" CHECK("discounts"."max_uses" IS NULL OR "discounts"."used_count" <= "discounts"."max_uses")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `discounts_code_uq` ON `discounts` (`code`);--> statement-breakpoint
CREATE TABLE `order_items` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`product_id` text,
	`product_slug` text NOT NULL,
	`product_name_en` text NOT NULL,
	`product_name_ar` text NOT NULL,
	`product_type` text NOT NULL,
	`image_key` text,
	`unit_price` integer NOT NULL,
	`unit_cost` integer,
	`quantity` integer NOT NULL,
	`line_total` integer NOT NULL,
	`options` text DEFAULT '[]' NOT NULL,
	`is_physical` integer NOT NULL,
	`is_digital` integer NOT NULL,
	`stock_deducted` integer DEFAULT false NOT NULL,
	`download_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "order_items_money_ck" CHECK("order_items"."quantity" > 0 AND "order_items"."unit_price" >= 0 AND "order_items"."line_total" = "order_items"."unit_price" * "order_items"."quantity")
);
--> statement-breakpoint
CREATE INDEX `order_items_order_idx` ON `order_items` (`order_id`);--> statement-breakpoint
CREATE INDEX `order_items_product_idx` ON `order_items` (`product_id`);--> statement-breakpoint
CREATE TABLE `order_status_history` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`from_status` text,
	`to_status` text NOT NULL,
	`actor_type` text NOT NULL,
	`actor_id` text,
	`actor_label` text NOT NULL,
	`public_note` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `order_status_history_order_idx` ON `order_status_history` (`order_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`order_number` text NOT NULL,
	`user_id` text,
	`idempotency_key` text NOT NULL,
	`access_token_hash` text NOT NULL,
	`customer_name` text NOT NULL,
	`customer_phone` text NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`payment_method` text DEFAULT 'COD' NOT NULL,
	`payment_status` text DEFAULT 'PENDING' NOT NULL,
	`currency` text DEFAULT 'IQD' NOT NULL,
	`subtotal` integer NOT NULL,
	`discount_total` integer DEFAULT 0 NOT NULL,
	`delivery_fee` integer DEFAULT 0 NOT NULL,
	`total` integer NOT NULL,
	`discount_id` text,
	`discount_code` text,
	`has_physical` integer NOT NULL,
	`has_digital` integer NOT NULL,
	`delivery_zone_id` text,
	`governorate_en` text,
	`governorate_ar` text,
	`city` text,
	`district` text,
	`address_line` text,
	`landmark` text,
	`delivery_notes` text,
	`order_notes` text,
	`admin_notes` text,
	`locale` text DEFAULT 'ar' NOT NULL,
	`custom_request_id` text,
	`confirmed_at` integer,
	`delivered_at` integer,
	`cancelled_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`discount_id`) REFERENCES `discounts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`delivery_zone_id`) REFERENCES `delivery_zones`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "orders_money_ck" CHECK("orders"."subtotal" >= 0 AND "orders"."discount_total" >= 0 AND "orders"."delivery_fee" >= 0 AND "orders"."discount_total" <= "orders"."subtotal" AND "orders"."total" = "orders"."subtotal" - "orders"."discount_total" + "orders"."delivery_fee")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_number_uq` ON `orders` (`order_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `orders_idempotency_uq` ON `orders` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `orders_user_idx` ON `orders` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `orders_status_idx` ON `orders` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `orders_created_idx` ON `orders` (`created_at`);--> statement-breakpoint
CREATE INDEX `orders_phone_idx` ON `orders` (`customer_phone`);--> statement-breakpoint
CREATE TABLE `password_reset_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_by_admin_id` text,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_admin_id`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `prt_user_idx` ON `password_reset_tokens` (`user_id`);--> statement-breakpoint
CREATE TABLE `product_images` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`r2_key` text NOT NULL,
	`width` integer,
	`height` integer,
	`alt_en` text DEFAULT '' NOT NULL,
	`alt_ar` text DEFAULT '' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `product_images_product_idx` ON `product_images` (`product_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `product_option_values` (
	`id` text PRIMARY KEY NOT NULL,
	`option_id` text NOT NULL,
	`label_en` text NOT NULL,
	`label_ar` text NOT NULL,
	`price_delta` integer DEFAULT 0 NOT NULL,
	`swatch` text,
	`is_default` integer DEFAULT false NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`option_id`) REFERENCES `product_options`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "product_option_values_price_ck" CHECK("product_option_values"."price_delta" >= 0)
);
--> statement-breakpoint
CREATE INDEX `product_option_values_option_idx` ON `product_option_values` (`option_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `product_options` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`type` text NOT NULL,
	`label_en` text NOT NULL,
	`label_ar` text NOT NULL,
	`help_en` text DEFAULT '' NOT NULL,
	`help_ar` text DEFAULT '' NOT NULL,
	`is_required` integer DEFAULT false NOT NULL,
	`price_delta` integer DEFAULT 0 NOT NULL,
	`price_per_unit` integer DEFAULT 0 NOT NULL,
	`min_value` integer,
	`max_value` integer,
	`unit_en` text DEFAULT '' NOT NULL,
	`unit_ar` text DEFAULT '' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "product_options_price_ck" CHECK("product_options"."price_delta" >= 0 AND "product_options"."price_per_unit" >= 0)
);
--> statement-breakpoint
CREATE INDEX `product_options_product_idx` ON `product_options` (`product_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `product_relations` (
	`product_id` text NOT NULL,
	`related_product_id` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`product_id`, `related_product_id`),
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`related_product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`product_type` text NOT NULL,
	`category_id` text NOT NULL,
	`name_en` text NOT NULL,
	`name_ar` text NOT NULL,
	`summary_en` text DEFAULT '' NOT NULL,
	`summary_ar` text DEFAULT '' NOT NULL,
	`description_en` text DEFAULT '' NOT NULL,
	`description_ar` text DEFAULT '' NOT NULL,
	`base_price` integer NOT NULL,
	`sale_price` integer,
	`cost_price` integer,
	`currency` text DEFAULT 'IQD' NOT NULL,
	`availability` text NOT NULL,
	`stock_quantity` integer,
	`production_days_min` integer,
	`production_days_max` integer,
	`length_mm` integer,
	`width_mm` integer,
	`height_mm` integer,
	`weight_grams` integer,
	`materials` text DEFAULT '[]' NOT NULL,
	`colors` text DEFAULT '[]' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`specifications` text DEFAULT '[]' NOT NULL,
	`features` text DEFAULT '[]' NOT NULL,
	`included` text DEFAULT '[]' NOT NULL,
	`seo_title_en` text,
	`seo_title_ar` text,
	`seo_description_en` text,
	`seo_description_ar` text,
	`preview_model_key` text,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`is_featured` integer DEFAULT false NOT NULL,
	`search_text` text DEFAULT '' NOT NULL,
	`published_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "products_price_ck" CHECK("products"."base_price" >= 0 AND ("products"."sale_price" IS NULL OR "products"."sale_price" >= 0)),
	CONSTRAINT "products_cost_ck" CHECK("products"."cost_price" IS NULL OR "products"."cost_price" >= 0),
	CONSTRAINT "products_stock_ck" CHECK("products"."stock_quantity" IS NULL OR "products"."stock_quantity" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `products_slug_uq` ON `products` (`slug`);--> statement-breakpoint
CREATE INDEX `products_status_created_idx` ON `products` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `products_category_idx` ON `products` (`category_id`);--> statement-breakpoint
CREATE INDEX `products_type_idx` ON `products` (`product_type`);--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`ip_hash` text,
	`user_agent` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_expires_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `site_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_by` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`updated_by`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_key` text NOT NULL,
	`purpose` text NOT NULL,
	`r2_key` text NOT NULL,
	`filename` text NOT NULL,
	`extension` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`attached_type` text,
	`attached_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `uploads_owner_idx` ON `uploads` (`owner_key`);--> statement-breakpoint
CREATE INDEX `uploads_attached_idx` ON `uploads` (`attached_type`,`attached_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`phone` text NOT NULL,
	`name` text NOT NULL,
	`password_hash` text NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`locale` text DEFAULT 'ar' NOT NULL,
	`last_login_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_phone_uq` ON `users` (`phone`);--> statement-breakpoint
CREATE TABLE `wishlist_items` (
	`user_id` text NOT NULL,
	`product_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `product_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
