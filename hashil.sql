-- phpMyAdmin SQL Dump
-- version 5.2.1
-- https://www.phpmyadmin.net/
--
-- Host: 127.0.0.1
-- Generation Time: Oct 13, 2026 at 03:27 PM
-- Server version: 10.4.32-MariaDB
-- PHP Version: 8.2.12

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `hashil`
--

-- --------------------------------------------------------

--
-- Table structure for table `app_meta`
--

CREATE TABLE `app_meta` (
  `key` varchar(64) NOT NULL,
  `value` longtext NOT NULL CHECK (json_valid(`value`)),
  `updated_at` datetime(6) NOT NULL DEFAULT current_timestamp(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

--
-- Dumping data for table `app_meta`
--

INSERT INTO `app_meta` (`key`, `value`, `updated_at`) VALUES
('initialized', '\"2026-10-13T11:01:05.387986+05:30\"', '2026-10-13 05:31:05.387000');

-- --------------------------------------------------------

--
-- Table structure for table `app_users`
--

CREATE TABLE `app_users` (
  `id` bigint(20) NOT NULL,
  `name` text DEFAULT NULL,
  `email` text DEFAULT NULL,
  `role` text DEFAULT NULL,
  `status` text DEFAULT NULL,
  `position` int(11) NOT NULL DEFAULT 0,
  `extra` longtext NOT NULL DEFAULT '{}' CHECK (json_valid(`extra`)),
  `created_at` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  `updated_at` datetime(6) NOT NULL DEFAULT current_timestamp(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

--
-- Dumping data for table `app_users`
--

INSERT INTO `app_users` (`id`, `name`, `email`, `role`, `status`, `position`, `extra`, `created_at`, `updated_at`) VALUES
(1, 'Aarav Kapoor', 'aarav@learnex.lk', 'Administrator', 'Active', 1, '{}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
(2, 'Sanduni Weeraratne', 'sanduni@learnex.lk', 'Sales & POS', 'Active', 2, '{}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
(3, 'Dilshan Perera', 'dilshan@learnex.lk', 'Inventory Manager', 'Active', 3, '{}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
(4, 'Hasini Gunawardena', 'hasini@learnex.lk', 'Accountant', 'Invited', 4, '{}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000');

-- --------------------------------------------------------

--
-- Table structure for table `audit_log`
--

CREATE TABLE `audit_log` (
  `id` bigint(20) NOT NULL,
  `at` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  `user_id` bigint(20) DEFAULT NULL,
  `username` varchar(64) DEFAULT NULL,
  `action` varchar(64) NOT NULL,
  `target` text DEFAULT NULL,
  `details` longtext NOT NULL DEFAULT '{}' CHECK (json_valid(`details`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

--
-- Dumping data for table `audit_log`
--

INSERT INTO `audit_log` (`id`, `at`, `user_id`, `username`, `action`, `target`, `details`) VALUES
(1, '2026-10-13 06:21:07.879000', 1, 'Hashil_Ranasinghe', 'auth.setup', 'Hashil_Ranasinghe', '{\"name\":\"Hashil Ranasinghe\"}'),
(2, '2026-10-13 06:21:43.152000', 1, 'Hashil_Ranasinghe', 'auth.logout', 'Hashil_Ranasinghe', '{}'),
(3, '2026-10-13 06:21:48.116000', 1, 'Hashil_Ranasinghe', 'auth.login', 'Hashil_Ranasinghe', '{\"userAgent\":\"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36 Edg/155.\"}'),
(4, '2026-10-13 06:25:18.201000', 1, 'Hashil_Ranasinghe', 'user.create', 'heshan_koralagamage', '{\"name\":\"Heshan Koralagamage\",\"roles\":[\"Owner\"]}'),
(5, '2026-10-13 06:25:27.898000', 1, 'Hashil_Ranasinghe', 'auth.logout', 'Hashil_Ranasinghe', '{}'),
(6, '2026-10-13 06:25:36.877000', 2, 'heshan_koralagamage', 'auth.login', 'heshan_koralagamage', '{\"userAgent\":\"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36 Edg/155.\"}'),
(7, '2026-10-13 06:25:55.747000', 2, 'heshan_koralagamage', 'auth.password_change', 'heshan_koralagamage', '{\"otherSessionsSignedOut\":0}'),
(8, '2026-10-13 06:26:30.748000', 2, 'heshan_koralagamage', 'data.save', 'settings', '{\"changes\":[{\"store\":\"settings\",\"updated\":1}]}'),
(9, '2026-10-13 13:00:51.459306', 1, 'Hashil_Ranasinghe', 'auth.login', 'Hashil_Ranasinghe', '{\"userAgent\":\"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36 Edg/155.\"}');

-- --------------------------------------------------------

--
-- Table structure for table `auth_roles`
--

CREATE TABLE `auth_roles` (
  `id` bigint(20) NOT NULL,
  `key` varchar(64) NOT NULL,
  `name` varchar(60) NOT NULL,
  `description` varchar(300) NOT NULL DEFAULT '',
  `is_system` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  `updated_at` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  `name_key` varchar(60) GENERATED ALWAYS AS (lcase(`name`)) STORED
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

--
-- Dumping data for table `auth_roles`
--

INSERT INTO `auth_roles` (`id`, `key`, `name`, `description`, `is_system`, `created_at`, `updated_at`) VALUES
(1, 'owner', 'Owner', 'Full access to everything, including factory reset. Can\'t be changed.', 1, '2026-10-13 06:21:07.879000', '2026-10-13 06:21:07.879000'),
(2, 'administrator', 'Administrator', 'Runs the whole system day to day: every module, staff accounts and roles. No factory reset.', 0, '2026-10-13 06:21:07.879000', '2026-10-13 06:21:07.879000'),
(3, 'sales', 'Sales & POS', 'Front counter: POS, sales orders, customers and delivery runs.', 0, '2026-10-13 06:21:07.879000', '2026-10-13 06:21:07.879000'),
(4, 'inventory', 'Inventory Manager', 'Stock: products, purchases, raw materials and suppliers.', 0, '2026-10-13 06:21:07.879000', '2026-10-13 06:21:07.879000'),
(5, 'accountant', 'Accountant', 'Finance: dashboard, cash & bank, accounting, reports and backups.', 0, '2026-10-13 06:21:07.879000', '2026-10-13 06:21:07.879000');

-- --------------------------------------------------------

--
-- Table structure for table `auth_role_permissions`
--

CREATE TABLE `auth_role_permissions` (
  `role_id` bigint(20) NOT NULL,
  `permission` varchar(64) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

--
-- Dumping data for table `auth_role_permissions`
--

INSERT INTO `auth_role_permissions` (`role_id`, `permission`) VALUES
(2, 'accounting.manage'),
(2, 'audit.view'),
(2, 'cash.manage'),
(2, 'customers.manage'),
(2, 'dashboard.view'),
(2, 'data.backup'),
(2, 'data.restore'),
(2, 'delivery.manage'),
(2, 'inventory.manage'),
(2, 'pos.use'),
(2, 'purchases.manage'),
(2, 'rawMaterials.manage'),
(2, 'reports.view'),
(2, 'roles.manage'),
(2, 'sales.manage'),
(2, 'settings.manage'),
(2, 'suppliers.manage'),
(2, 'users.manage'),
(3, 'customers.manage'),
(3, 'delivery.manage'),
(3, 'pos.use'),
(3, 'sales.manage'),
(4, 'inventory.manage'),
(4, 'purchases.manage'),
(4, 'rawMaterials.manage'),
(4, 'suppliers.manage'),
(5, 'accounting.manage'),
(5, 'cash.manage'),
(5, 'dashboard.view'),
(5, 'data.backup'),
(5, 'reports.view');

-- --------------------------------------------------------

--
-- Table structure for table `auth_sessions`
--

CREATE TABLE `auth_sessions` (
  `id` varchar(64) NOT NULL,
  `user_id` bigint(20) NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  `last_seen_at` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  `expires_at` datetime(6) NOT NULL,
  `absolute_expires_at` datetime(6) NOT NULL,
  `user_agent` varchar(300) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

--
-- Dumping data for table `auth_sessions`
--

INSERT INTO `auth_sessions` (`id`, `user_id`, `created_at`, `last_seen_at`, `expires_at`, `absolute_expires_at`, `user_agent`) VALUES
('d4fb290bfb38edf00f9c9c3ed363c9b5c9160d4acb5c399be91b217ae0f06144', 1, '2026-10-13 13:00:51.450999', '2026-10-13 13:00:51.450999', '2026-10-14 01:00:51.449000', '2026-10-20 13:00:51.449000', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36 Edg/155.0.0.0');

-- --------------------------------------------------------

--
-- Table structure for table `auth_users`
--

CREATE TABLE `auth_users` (
  `id` bigint(20) NOT NULL,
  `username` varchar(64) NOT NULL,
  `name` varchar(100) NOT NULL,
  `email` varchar(254) DEFAULT NULL,
  `password_hash` varchar(255) NOT NULL,
  `status` varchar(16) NOT NULL DEFAULT 'active' CHECK (`status` in ('active','disabled')),
  `must_change_password` tinyint(1) NOT NULL DEFAULT 0,
  `failed_login_count` int(11) NOT NULL DEFAULT 0,
  `locked_until` datetime(6) DEFAULT NULL,
  `last_login_at` datetime(6) DEFAULT NULL,
  `password_changed_at` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  `created_by` bigint(20) DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  `updated_at` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  `username_key` varchar(64) GENERATED ALWAYS AS (lcase(`username`)) STORED,
  `email_key` varchar(254) GENERATED ALWAYS AS (lcase(`email`)) STORED
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

--
-- Dumping data for table `auth_users`
--

INSERT INTO `auth_users` (`id`, `username`, `name`, `email`, `password_hash`, `status`, `must_change_password`, `failed_login_count`, `locked_until`, `last_login_at`, `password_changed_at`, `created_by`, `created_at`, `updated_at`) VALUES
(1, 'Hashil_Ranasinghe', 'Hashil Ranasinghe', NULL, 'scrypt$65536$8$2$KzfLHQWV/KE5wsEjRyErOQ==$/SPa7DqpU06nHMqfLDrXGaOBWACWYHoFgeK+QtS3Q7cLuvjY4GD1sNpvI8YRjn09CrXglD2J1ANkOGYxLdKWKQ==', 'active', 0, 0, NULL, '2026-10-13 13:00:51.447492', '2026-10-13 06:21:07.879000', NULL, '2026-10-13 06:21:07.879000', '2026-10-13 06:21:07.879000'),
(2, 'heshan_koralagamage', 'Heshan Koralagamage', 'heshankoralagamage2002@gmail.com', 'scrypt$65536$8$2$e0l2LZgZROWdQVM7gr+WuA==$FwDfaFFrLdUkvN9b8TLu55aNv6fmH3jpDBu/WQHJy/agnl7l9UBYFl1EDqkZBGjsLGF47HSryuL2ZaXWmD1ezA==', 'active', 0, 0, NULL, '2026-10-13 06:25:36.873000', '2026-10-13 06:25:55.742000', 1, '2026-10-13 06:25:18.201000', '2026-10-13 06:25:55.742000');

-- --------------------------------------------------------

--
-- Table structure for table `auth_user_roles`
--

CREATE TABLE `auth_user_roles` (
  `user_id` bigint(20) NOT NULL,
  `role_id` bigint(20) NOT NULL,
  `granted_by` bigint(20) DEFAULT NULL,
  `granted_at` datetime(6) NOT NULL DEFAULT current_timestamp(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

--
-- Dumping data for table `auth_user_roles`
--

INSERT INTO `auth_user_roles` (`user_id`, `role_id`, `granted_by`, `granted_at`) VALUES
(1, 1, NULL, '2026-10-13 06:21:07.879000'),
(2, 1, 1, '2026-10-13 06:25:18.201000');

-- --------------------------------------------------------

--
-- Table structure for table `business_settings`
--

CREATE TABLE `business_settings` (
  `id` smallint(6) NOT NULL DEFAULT 1 CHECK (`id` = 1),
  `business_name` text DEFAULT NULL,
  `tax_rate` decimal(65,30) DEFAULT NULL,
  `opening_capital` decimal(65,30) DEFAULT NULL,
  `currency` text DEFAULT NULL,
  `notif_low_stock` tinyint(1) DEFAULT NULL,
  `notif_overdue` tinyint(1) DEFAULT NULL,
  `notif_daily` tinyint(1) DEFAULT NULL,
  `extra` longtext NOT NULL DEFAULT '{}' CHECK (json_valid(`extra`)),
  `updated_at` datetime(6) NOT NULL DEFAULT current_timestamp(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

--
-- Dumping data for table `business_settings`
--

INSERT INTO `business_settings` (`id`, `business_name`, `tax_rate`, `opening_capital`, `currency`, `notif_low_stock`, `notif_overdue`, `notif_daily`, `extra`, `updated_at`) VALUES
(1, 'LEARNEX Printers & Distributors', NULL, 0.000000000000000000000000000000, 'LKR (Rs.)', 1, 1, 0, '{\"taxRate\":\"0\"}', '2026-10-13 06:26:30.748000');

-- --------------------------------------------------------

--
-- Table structure for table `cash_accounts`
--

CREATE TABLE `cash_accounts` (
  `id` varchar(191) NOT NULL,
  `name` text DEFAULT NULL,
  `type` text DEFAULT NULL,
  `opening` decimal(65,30) DEFAULT NULL,
  `purpose` text DEFAULT NULL,
  `system` tinyint(1) DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `position` int(11) NOT NULL DEFAULT 0,
  `extra` longtext NOT NULL DEFAULT '{}' CHECK (json_valid(`extra`)),
  `created_at` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  `updated_at` datetime(6) NOT NULL DEFAULT current_timestamp(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

--
-- Dumping data for table `cash_accounts`
--

INSERT INTO `cash_accounts` (`id`, `name`, `type`, `opening`, `purpose`, `system`, `notes`, `position`, `extra`, `created_at`, `updated_at`) VALUES
('BANK-MAIN', 'Bank Account', 'Bank', 0.000000000000000000000000000000, 'general', 1, 'Bank balance. Use transfers to move money to or from cash.', 2, '{}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
('CASH-MAIN', 'Cash Account', 'Cash', 0.000000000000000000000000000000, 'general', 1, 'Day-to-day cash: sales receipts, operating expenses, and purchases of stock and raw materials.', 1, '{}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000');

-- --------------------------------------------------------

--
-- Table structure for table `customers`
--

CREATE TABLE `customers` (
  `id` bigint(20) NOT NULL,
  `name` text DEFAULT NULL,
  `contact` text DEFAULT NULL,
  `phone` text DEFAULT NULL,
  `email` text DEFAULT NULL,
  `tier` text DEFAULT NULL,
  `orders` int(11) DEFAULT NULL,
  `spent` decimal(65,30) DEFAULT NULL,
  `outstanding` decimal(65,30) DEFAULT NULL,
  `position` int(11) NOT NULL DEFAULT 0,
  `extra` longtext NOT NULL DEFAULT '{}' CHECK (json_valid(`extra`)),
  `created_at` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  `updated_at` datetime(6) NOT NULL DEFAULT current_timestamp(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

--
-- Dumping data for table `customers`
--

INSERT INTO `customers` (`id`, `name`, `contact`, `phone`, `email`, `tier`, `orders`, `spent`, `outstanding`, `position`, `extra`, `created_at`, `updated_at`) VALUES
(1, 'Golden Star Traders', 'Ramesh Iyer', '+94 77 210 4432', 'ramesh@goldenstar.lk', 'Wholesale', 38, 1842500.000000000000000000000000000000, 0.000000000000000000000000000000, 1, '{}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
(2, 'Meridian Office Supplies', 'Nadia Farooq', '+94 71 556 8821', 'nadia@meridianos.lk', 'Wholesale', 52, 3120800.000000000000000000000000000000, 128900.000000000000000000000000000000, 2, '{}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
(3, 'Al Noor Stationery', 'Yusuf Hamdan', '+94 76 340 1198', 'yusuf@alnoor.lk', 'Retail', 14, 214600.000000000000000000000000000000, 8600.000000000000000000000000000000, 3, '{}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
(4, 'Continental Traders', 'Priya Devendra', '+94 70 902 7745', 'priya@continental.lk', 'Wholesale', 29, 1298400.000000000000000000000000000000, 0.000000000000000000000000000000, 4, '{}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
(5, 'Falcon Print Hub', 'Omar Sheikh', '+94 77 663 5590', 'omar@falconprint.lk', 'Retail', 9, 96300.000000000000000000000000000000, 19750.000000000000000000000000000000, 5, '{}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
(6, 'Silverline Enterprises', 'Anjali Rathnayake', '+94 72 118 6634', 'anjali@silverline.lk', 'Retail', 6, 58200.000000000000000000000000000000, 33400.000000000000000000000000000000, 6, '{}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
(7, 'Crescent Business Center', 'Farhan Malik', '+94 75 441 0087', 'farhan@crescentbc.lk', 'Wholesale', 21, 876200.000000000000000000000000000000, 0.000000000000000000000000000000, 7, '{}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
(8, 'Blue Horizon Traders', 'Ishara Perera', '+94 71 229 3345', 'ishara@bluehorizon.lk', 'Retail', 11, 143700.000000000000000000000000000000, 0.000000000000000000000000000000, 8, '{}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000');

-- --------------------------------------------------------

--
-- Table structure for table `delivery_credit_bills`
--

CREATE TABLE `delivery_credit_bills` (
  `run_id` varchar(191) NOT NULL,
  `line_no` int(11) NOT NULL,
  `shop` text DEFAULT NULL,
  `note` text DEFAULT NULL,
  `qty` decimal(65,30) DEFAULT NULL,
  `total` decimal(65,30) DEFAULT NULL,
  `items` longtext DEFAULT NULL CHECK (json_valid(`items`)),
  `extra` longtext NOT NULL DEFAULT '{}' CHECK (json_valid(`extra`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- --------------------------------------------------------

--
-- Table structure for table `delivery_runs`
--

CREATE TABLE `delivery_runs` (
  `id` varchar(191) NOT NULL,
  `date` date DEFAULT NULL,
  `status` text DEFAULT NULL,
  `total_taken` decimal(65,30) DEFAULT NULL,
  `completed_date` date DEFAULT NULL,
  `sold_qty` decimal(65,30) DEFAULT NULL,
  `sale_amount` decimal(65,30) DEFAULT NULL,
  `cost_amount` decimal(65,30) DEFAULT NULL,
  `daily_expense` decimal(65,30) DEFAULT NULL,
  `profit` decimal(65,30) DEFAULT NULL,
  `net_profit` decimal(65,30) DEFAULT NULL,
  `ledger_txn_id` text DEFAULT NULL,
  `credit_txn_id` text DEFAULT NULL,
  `expense_txn_ids` longtext DEFAULT NULL CHECK (json_valid(`expense_txn_ids`)),
  `credit_amount` decimal(65,30) DEFAULT NULL,
  `cash_collected` decimal(65,30) DEFAULT NULL,
  `credit_order_ids` longtext DEFAULT NULL CHECK (json_valid(`credit_order_ids`)),
  `position` int(11) NOT NULL DEFAULT 0,
  `extra` longtext NOT NULL DEFAULT '{}' CHECK (json_valid(`extra`)),
  `created_at` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  `updated_at` datetime(6) NOT NULL DEFAULT current_timestamp(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- --------------------------------------------------------

--
-- Table structure for table `delivery_run_items`
--

CREATE TABLE `delivery_run_items` (
  `run_id` varchar(191) NOT NULL,
  `line_no` int(11) NOT NULL,
  `product_id` bigint(20) DEFAULT NULL,
  `name` text DEFAULT NULL,
  `price` decimal(65,30) DEFAULT NULL,
  `cost` decimal(65,30) DEFAULT NULL,
  `unit` text DEFAULT NULL,
  `taken` decimal(65,30) DEFAULT NULL,
  `returned` decimal(65,30) DEFAULT NULL,
  `sold` decimal(65,30) DEFAULT NULL,
  `sale_amount` decimal(65,30) DEFAULT NULL,
  `avg_price` decimal(65,30) DEFAULT NULL,
  `over_sold` tinyint(1) DEFAULT NULL,
  `sales` longtext DEFAULT NULL CHECK (json_valid(`sales`)),
  `extra` longtext NOT NULL DEFAULT '{}' CHECK (json_valid(`extra`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- --------------------------------------------------------

--
-- Table structure for table `ledger_entries`
--

CREATE TABLE `ledger_entries` (
  `id` varchar(191) NOT NULL,
  `date` date DEFAULT NULL,
  `description` text DEFAULT NULL,
  `type` text DEFAULT NULL,
  `category` text DEFAULT NULL,
  `amount` decimal(65,30) DEFAULT NULL,
  `account` text DEFAULT NULL,
  `kind` text DEFAULT NULL,
  `cash` tinyint(1) DEFAULT NULL,
  `attachment` longtext DEFAULT NULL CHECK (json_valid(`attachment`)),
  `position` int(11) NOT NULL DEFAULT 0,
  `extra` longtext NOT NULL DEFAULT '{}' CHECK (json_valid(`extra`)),
  `created_at` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  `updated_at` datetime(6) NOT NULL DEFAULT current_timestamp(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

--
-- Dumping data for table `ledger_entries`
--

INSERT INTO `ledger_entries` (`id`, `date`, `description`, `type`, `category`, `amount`, `account`, `kind`, `cash`, `attachment`, `position`, `extra`, `created_at`, `updated_at`) VALUES
('TXN-8809', '2026-07-11', 'Sales revenue — INV-2452 (Meridian Office Supplies)', 'Income', 'Sales', 176400.000000000000000000000000000000, NULL, NULL, NULL, NULL, 13, '{}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
('TXN-8810', '2026-07-12', 'Sales revenue — INV-2453 (Blue Horizon Traders)', 'Income', 'Sales', 51200.000000000000000000000000000000, NULL, NULL, NULL, NULL, 12, '{}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
('TXN-8811', '2026-07-13', 'Sales revenue — INV-2455 (Crescent Business Center)', 'Income', 'Sales', 94800.000000000000000000000000000000, NULL, NULL, NULL, NULL, 11, '{}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
('TXN-8812', '2026-07-14', 'Sales revenue — INV-2456 (Silverline Enterprises)', 'Income', 'Sales', 33400.000000000000000000000000000000, NULL, 'revenue', 0, NULL, 9, '{}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
('TXN-8813', '2026-07-15', 'Sales revenue — INV-2459 (Al Noor Stationery)', 'Income', 'Sales', 8600.000000000000000000000000000000, NULL, 'revenue', 0, NULL, 6, '{}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
('TXN-8814', '2026-07-13', 'Electricity & utilities', 'Expense', 'Utilities', 28400.000000000000000000000000000000, NULL, NULL, NULL, NULL, 10, '{}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
('TXN-8815', '2026-07-14', 'Sales revenue — INV-2457', 'Income', 'Sales', 19750.000000000000000000000000000000, NULL, NULL, NULL, NULL, 8, '{}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
('TXN-8816', '2026-07-14', 'Warehouse rent — July', 'Expense', 'Rent', 95000.000000000000000000000000000000, NULL, NULL, NULL, NULL, 7, '{}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
('TXN-8817', '2026-07-15', 'Sales revenue — INV-2458', 'Income', 'Sales', 62300.000000000000000000000000000000, NULL, NULL, NULL, NULL, 5, '{}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
('TXN-8818', '2026-07-15', 'Purchase order — Epson Regional Supply', 'Expense', 'Inventory', 312000.000000000000000000000000000000, NULL, NULL, NULL, NULL, 4, '{}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
('TXN-8819', '2026-07-16', 'Staff salaries — July', 'Expense', 'Payroll', 186000.000000000000000000000000000000, NULL, NULL, NULL, NULL, 3, '{}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
('TXN-8820', '2026-07-16', 'Sales revenue — INV-2460', 'Income', 'Sales', 128900.000000000000000000000000000000, NULL, NULL, NULL, NULL, 2, '{}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
('TXN-8821', '2026-07-16', 'Sales revenue — INV-2461', 'Income', 'Sales', 45200.000000000000000000000000000000, NULL, NULL, NULL, NULL, 1, '{}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000');

-- --------------------------------------------------------

--
-- Table structure for table `products`
--

CREATE TABLE `products` (
  `id` bigint(20) NOT NULL,
  `name` text DEFAULT NULL,
  `sku` text DEFAULT NULL,
  `category` text DEFAULT NULL,
  `price` decimal(65,30) DEFAULT NULL,
  `cost` decimal(65,30) DEFAULT NULL,
  `stock` decimal(65,30) DEFAULT NULL,
  `min_stock` decimal(65,30) DEFAULT NULL,
  `unit` text DEFAULT NULL,
  `position` int(11) NOT NULL DEFAULT 0,
  `extra` longtext NOT NULL DEFAULT '{}' CHECK (json_valid(`extra`)),
  `created_at` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  `updated_at` datetime(6) NOT NULL DEFAULT current_timestamp(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

--
-- Dumping data for table `products`
--

INSERT INTO `products` (`id`, `name`, `sku`, `category`, `price`, `cost`, `stock`, `min_stock`, `unit`, `position`, `extra`, `created_at`, `updated_at`) VALUES
(1, 'HP LaserJet Pro M404dn', 'PRN-HP404', 'Printers', 42500.000000000000000000000000000000, 32000.000000000000000000000000000000, 24.000000000000000000000000000000, 10.000000000000000000000000000000, 'pc', 1, '{}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
(2, 'Canon PIXMA G3010', 'PRN-CN301', 'Printers', 21900.000000000000000000000000000000, 16500.000000000000000000000000000000, 8.000000000000000000000000000000, 10.000000000000000000000000000000, 'pc', 2, '{}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
(3, 'Epson EcoTank L3250', 'PRN-EP325', 'Printers', 26800.000000000000000000000000000000, 20000.000000000000000000000000000000, 0.000000000000000000000000000000, 8.000000000000000000000000000000, 'pc', 3, '{}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
(4, 'HP 12A Toner Cartridge', 'TNR-HP12A', 'Ink & Toner', 3200.000000000000000000000000000000, 2100.000000000000000000000000000000, 65.000000000000000000000000000000, 20.000000000000000000000000000000, 'pc', 4, '{}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
(5, 'Canon 728 Toner', 'TNR-CN728', 'Ink & Toner', 4100.000000000000000000000000000000, 2800.000000000000000000000000000000, 5.000000000000000000000000000000, 15.000000000000000000000000000000, 'pc', 5, '{}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
(6, 'Epson 664 Ink Bottle Set', 'INK-EP664', 'Ink & Toner', 1850.000000000000000000000000000000, 1150.000000000000000000000000000000, 40.000000000000000000000000000000, 15.000000000000000000000000000000, 'set', 6, '{}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
(7, 'A4 Copier Paper 80gsm', 'PPR-A4-80', 'Paper & Stationery', 285.000000000000000000000000000000, 210.000000000000000000000000000000, 320.000000000000000000000000000000, 50.000000000000000000000000000000, 'ream', 7, '{}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
(8, 'A3 Copier Paper 80gsm', 'PPR-A3-80', 'Paper & Stationery', 540.000000000000000000000000000000, 400.000000000000000000000000000000, 12.000000000000000000000000000000, 20.000000000000000000000000000000, 'ream', 8, '{}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
(9, 'Sticky Notes Pack', 'STA-STK01', 'Paper & Stationery', 95.000000000000000000000000000000, 55.000000000000000000000000000000, 0.000000000000000000000000000000, 10.000000000000000000000000000000, 'pack', 9, '{}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
(10, 'Printer Drum Unit', 'SPR-DRM01', 'Spare Parts', 5600.000000000000000000000000000000, 4100.000000000000000000000000000000, 18.000000000000000000000000000000, 8.000000000000000000000000000000, 'pc', 10, '{}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
(11, 'Fuser Assembly Kit', 'SPR-FSR01', 'Spare Parts', 8900.000000000000000000000000000000, 6700.000000000000000000000000000000, 3.000000000000000000000000000000, 6.000000000000000000000000000000, 'pc', 11, '{}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
(12, 'USB Printer Cable 3m', 'ACC-USB3M', 'Accessories', 320.000000000000000000000000000000, 180.000000000000000000000000000000, 90.000000000000000000000000000000, 20.000000000000000000000000000000, 'pc', 12, '{}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
(13, 'Wireless Print Server', 'ACC-WPS01', 'Accessories', 3450.000000000000000000000000000000, 2500.000000000000000000000000000000, 0.000000000000000000000000000000, 5.000000000000000000000000000000, 'pc', 13, '{}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
(14, 'Laminating Pouches A4 (100pk)', 'ACC-LAM100', 'Accessories', 650.000000000000000000000000000000, 420.000000000000000000000000000000, 55.000000000000000000000000000000, 15.000000000000000000000000000000, 'pack', 14, '{}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000');

-- --------------------------------------------------------

--
-- Table structure for table `purchase_orders`
--

CREATE TABLE `purchase_orders` (
  `id` varchar(191) NOT NULL,
  `supplier_name` text DEFAULT NULL,
  `supplier_id` bigint(20) DEFAULT NULL,
  `items` int(11) DEFAULT NULL,
  `total` decimal(65,30) DEFAULT NULL,
  `date` date DEFAULT NULL,
  `attachment` longtext DEFAULT NULL CHECK (json_valid(`attachment`)),
  `payment_status` text DEFAULT NULL,
  `amount_paid` decimal(65,30) DEFAULT NULL,
  `cash_account` text DEFAULT NULL,
  `topped_up_from` text DEFAULT NULL,
  `topped_up_amount` decimal(65,30) DEFAULT NULL,
  `ledger_txn_ids` longtext DEFAULT NULL CHECK (json_valid(`ledger_txn_ids`)),
  `position` int(11) NOT NULL DEFAULT 0,
  `extra` longtext NOT NULL DEFAULT '{}' CHECK (json_valid(`extra`)),
  `created_at` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  `updated_at` datetime(6) NOT NULL DEFAULT current_timestamp(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- --------------------------------------------------------

--
-- Table structure for table `purchase_order_items`
--

CREATE TABLE `purchase_order_items` (
  `order_id` varchar(191) NOT NULL,
  `line_no` int(11) NOT NULL,
  `material_id` bigint(20) DEFAULT NULL,
  `name` text DEFAULT NULL,
  `qty` decimal(65,30) DEFAULT NULL,
  `cost` decimal(65,30) DEFAULT NULL,
  `extra` longtext NOT NULL DEFAULT '{}' CHECK (json_valid(`extra`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- --------------------------------------------------------

--
-- Table structure for table `raw_materials`
--

CREATE TABLE `raw_materials` (
  `id` bigint(20) NOT NULL,
  `name` text DEFAULT NULL,
  `category` text DEFAULT NULL,
  `supplier_name` text DEFAULT NULL,
  `unit` text DEFAULT NULL,
  `purchase_qty` decimal(65,30) DEFAULT NULL,
  `available_qty` decimal(65,30) DEFAULT NULL,
  `cost_price` decimal(65,30) DEFAULT NULL,
  `last_purchase_cost` decimal(65,30) DEFAULT NULL,
  `purchase_date` date DEFAULT NULL,
  `batch_number` text DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `position` int(11) NOT NULL DEFAULT 0,
  `extra` longtext NOT NULL DEFAULT '{}' CHECK (json_valid(`extra`)),
  `created_at` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  `updated_at` datetime(6) NOT NULL DEFAULT current_timestamp(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

--
-- Dumping data for table `raw_materials`
--

INSERT INTO `raw_materials` (`id`, `name`, `category`, `supplier_name`, `unit`, `purchase_qty`, `available_qty`, `cost_price`, `last_purchase_cost`, `purchase_date`, `batch_number`, `notes`, `position`, `extra`, `created_at`, `updated_at`) VALUES
(1, 'Double Tape', 'Packaging', 'Azure Packaging', 'pc', 0.000000000000000000000000000000, 78.000000000000000000000000000000, 35.000000000000000000000000000000, NULL, NULL, '', '', 1, '{\"purchaseDate\":\"\"}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
(2, 'A4 Sheets', 'Packaging', 'Lakro Packaging Industries', 'pc', 0.000000000000000000000000000000, 800.000000000000000000000000000000, 1.840000000000000000000000000000, NULL, NULL, '', '', 2, '{\"purchaseDate\":\"\"}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
(3, 'Transparent A4 Sheets', 'Packaging', 'Vismass Inkjet', 'pc', 0.000000000000000000000000000000, 12.000000000000000000000000000000, 58.000000000000000000000000000000, NULL, NULL, '', '', 3, '{\"purchaseDate\":\"\"}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
(4, 'Glossy A4 Sticker Paper', 'Packaging', 'Vismass Inkjet', 'pc', 0.000000000000000000000000000000, 30.000000000000000000000000000000, 21.000000000000000000000000000000, NULL, NULL, '', '', 4, '{\"purchaseDate\":\"\"}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
(5, 'Matt A4 Sticker Paper', 'Packaging', 'BG Enterprises', 'pc', 0.000000000000000000000000000000, 100.000000000000000000000000000000, 11.000000000000000000000000000000, NULL, NULL, '', '', 5, '{\"purchaseDate\":\"\"}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
(6, 'Laminate Pouch', 'Packaging', 'BG Enterprises', 'pc', 0.000000000000000000000000000000, 103.000000000000000000000000000000, 13.000000000000000000000000000000, NULL, NULL, '', '', 6, '{\"purchaseDate\":\"\"}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
(7, 'Small Polythene Covers', 'Packaging', 'Zeylaan Packaging', 'pc', 0.000000000000000000000000000000, 400.000000000000000000000000000000, 2.500000000000000000000000000000, NULL, NULL, '', '', 7, '{\"purchaseDate\":\"\"}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
(8, 'Medium Polythene Covers', 'Packaging', 'Zeylaan Packaging', 'pc', 0.000000000000000000000000000000, 0.000000000000000000000000000000, 3.500000000000000000000000000000, NULL, NULL, '', '', 8, '{\"purchaseDate\":\"\"}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
(9, 'Large Polythene Covers', 'Packaging', 'Zeylaan Packaging', 'pc', 0.000000000000000000000000000000, 100.000000000000000000000000000000, 4.500000000000000000000000000000, NULL, NULL, '', '', 9, '{\"purchaseDate\":\"\"}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
(10, '1kg Inkjet INK Bottle', 'Packaging', 'Vismass Inkjet', 'kg', 0.000000000000000000000000000000, 3.000000000000000000000000000000, 3500.000000000000000000000000000000, NULL, NULL, '', '', 10, '{\"purchaseDate\":\"\"}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
(11, 'Pigment Ink Bottle', 'Packaging', 'Vismass Inkjet', 'pc', 0.000000000000000000000000000000, 0.000000000000000000000000000000, 1650.000000000000000000000000000000, NULL, NULL, '', '', 11, '{\"purchaseDate\":\"\"}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
(12, 'Torch Bulb', 'Packaging', 'ABM Technology', 'pc', 0.000000000000000000000000000000, 10.000000000000000000000000000000, 12.000000000000000000000000000000, NULL, NULL, '', '', 12, '{\"purchaseDate\":\"\"}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
(13, 'Torch Bulb Holder', 'Packaging', 'ABM Technology', 'pc', 0.000000000000000000000000000000, 40.000000000000000000000000000000, 18.000000000000000000000000000000, NULL, NULL, '', '', 13, '{\"purchaseDate\":\"\"}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
(14, 'Switch', 'Packaging', 'ABM Technology', 'pc', 0.000000000000000000000000000000, 27.000000000000000000000000000000, 7.500000000000000000000000000000, NULL, NULL, '', '', 14, '{\"purchaseDate\":\"\"}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
(15, 'Small Fan', 'Packaging', 'ABM Technology', 'pc', 0.000000000000000000000000000000, 25.000000000000000000000000000000, 10.000000000000000000000000000000, NULL, NULL, '', '', 15, '{\"purchaseDate\":\"\"}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
(16, 'Remote Battery', 'Packaging', 'ABM Technology', 'pc', 0.000000000000000000000000000000, 17.000000000000000000000000000000, 25.000000000000000000000000000000, NULL, NULL, '', '', 16, '{\"purchaseDate\":\"\"}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
(17, 'Pentorch Battery', 'Packaging', 'Lakro Packaging Industries', 'pc', 0.000000000000000000000000000000, 0.000000000000000000000000000000, 28.000000000000000000000000000000, NULL, NULL, '', '', 17, '{\"purchaseDate\":\"\"}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
(18, '9V Battery', 'Packaging', 'I & H Enterprises', 'pc', 0.000000000000000000000000000000, 0.000000000000000000000000000000, 85.000000000000000000000000000000, NULL, NULL, '', '', 18, '{\"purchaseDate\":\"\"}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
(19, 'Pentorch Battery', 'Packaging', 'ABM Technology', 'pc', 0.000000000000000000000000000000, 8.000000000000000000000000000000, 16.000000000000000000000000000000, NULL, NULL, '', '', 19, '{\"purchaseDate\":\"\"}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
(20, 'Kids Motor', 'Packaging', 'ABM Technology', 'pc', 0.000000000000000000000000000000, 4.000000000000000000000000000000, 23.500000000000000000000000000000, NULL, NULL, '', '', 20, '{\"purchaseDate\":\"\"}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
(21, '9v Battery Clip', 'Packaging', 'ABM Technology', 'pc', 0.000000000000000000000000000000, 12.000000000000000000000000000000, 10.000000000000000000000000000000, NULL, NULL, '', '', 21, '{\"purchaseDate\":\"\"}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
(22, 'Compass', 'Packaging', 'BG Enterprises', 'pc', 0.000000000000000000000000000000, 3.000000000000000000000000000000, 80.000000000000000000000000000000, NULL, NULL, '', '', 22, '{\"purchaseDate\":\"\"}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
(23, 'Wooden Keytag', 'Packaging', 'I & H Enterprises', 'pc', 0.000000000000000000000000000000, 0.000000000000000000000000000000, 20.000000000000000000000000000000, NULL, NULL, '', '', 23, '{\"purchaseDate\":\"\"}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
(24, 'Plastic Tuzzel Keytag', 'Packaging', 'I & H Enterprises', 'pc', 0.000000000000000000000000000000, 11.000000000000000000000000000000, 25.000000000000000000000000000000, NULL, NULL, '', '', 24, '{\"purchaseDate\":\"\"}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
(25, 'Silicon Keytag', 'Packaging', 'I & H Enterprises', 'pc', 0.000000000000000000000000000000, 0.000000000000000000000000000000, 31.250000000000000000000000000000, NULL, NULL, '', '', 25, '{\"purchaseDate\":\"\"}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
(26, 'Belt Kurumi Keytag', 'Packaging', 'I & H Enterprises', 'pc', 0.000000000000000000000000000000, 0.000000000000000000000000000000, 60.000000000000000000000000000000, NULL, NULL, '', '', 26, '{\"purchaseDate\":\"\"}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
(27, 'ID Pouch Small', 'Packaging', 'BG Enterprises', 'pc', 0.000000000000000000000000000000, 0.000000000000000000000000000000, 12.500000000000000000000000000000, NULL, NULL, '', '', 27, '{\"purchaseDate\":\"\"}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
(28, 'ID Pouch Medium', 'Plastics', 'BG Enterprises', 'pc', 0.000000000000000000000000000000, 0.000000000000000000000000000000, 25.000000000000000000000000000000, NULL, NULL, '', '', 28, '{\"purchaseDate\":\"\"}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
(29, 'ID Pouch Large', 'Packaging', 'BG Enterprises', 'pc', 0.000000000000000000000000000000, 3.000000000000000000000000000000, 35.000000000000000000000000000000, NULL, NULL, '', '', 29, '{\"purchaseDate\":\"\"}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
(30, 'ID Pouch - Landscape', 'Packaging', 'BG Enterprises', 'pc', 0.000000000000000000000000000000, 0.000000000000000000000000000000, 15.000000000000000000000000000000, NULL, NULL, '', '', 30, '{\"purchaseDate\":\"\"}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
(31, 'Design Pencil', 'Packaging', 'BG Enterprises', 'pc', 0.000000000000000000000000000000, 4.000000000000000000000000000000, 38.000000000000000000000000000000, NULL, NULL, '', '', 31, '{\"purchaseDate\":\"\"}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
(32, 'Erasable Pen - Kids', 'Packaging', 'I & H Enterprises', 'pc', 0.000000000000000000000000000000, 11.000000000000000000000000000000, 55.000000000000000000000000000000, NULL, NULL, '', '', 32, '{\"purchaseDate\":\"\"}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
(33, 'Erasable Pen - Adults', 'Plastics', 'BG Enterprises', 'pc', 0.000000000000000000000000000000, 3.000000000000000000000000000000, 75.000000000000000000000000000000, NULL, NULL, '', '', 33, '{\"purchaseDate\":\"\"}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
(34, 'Lego Puzzel - Small', 'Packaging', 'I & H Enterprises', 'pc', 0.000000000000000000000000000000, 0.000000000000000000000000000000, 42.500000000000000000000000000000, NULL, NULL, '', '', 34, '{\"purchaseDate\":\"\"}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
(35, 'Lego Puzzel - Large', 'Packaging', 'BG Enterprises', 'pc', 0.000000000000000000000000000000, 0.000000000000000000000000000000, 62.500000000000000000000000000000, NULL, NULL, '', '', 35, '{\"purchaseDate\":\"\"}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
(36, 'Lego Puzzel Box', 'Packaging', 'I & H Enterprises', 'pc', 0.000000000000000000000000000000, 0.000000000000000000000000000000, 135.000000000000000000000000000000, NULL, NULL, '', '', 36, '{\"purchaseDate\":\"\"}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
(37, 'Star Card', 'Packaging', 'I & H Enterprises', 'pc', 0.000000000000000000000000000000, 0.000000000000000000000000000000, 7.500000000000000000000000000000, NULL, NULL, '', '', 37, '{\"purchaseDate\":\"\"}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
(38, 'Bomb Card', 'Packaging', 'I & H Enterprises', 'pc', 0.000000000000000000000000000000, 0.000000000000000000000000000000, 13.750000000000000000000000000000, NULL, NULL, '', '', 38, '{\"purchaseDate\":\"\"}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
(39, 'Bus Sticker', 'Packaging', 'I & H Enterprises', 'pc', 0.000000000000000000000000000000, 0.000000000000000000000000000000, 6.500000000000000000000000000000, NULL, NULL, '', '', 39, '{\"purchaseDate\":\"\"}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
(40, 'Tepix Tape', 'Packaging', 'I & H Enterprises', 'pc', 0.000000000000000000000000000000, 0.000000000000000000000000000000, 65.000000000000000000000000000000, NULL, NULL, '', '', 40, '{\"purchaseDate\":\"\"}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
(41, 'ID Clip', 'Packaging', 'BG Enterprises', 'pc', 0.000000000000000000000000000000, 0.000000000000000000000000000000, 6.500000000000000000000000000000, NULL, NULL, '', '', 41, '{\"purchaseDate\":\"\"}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
(42, 'Name Tag', 'Packaging', 'BG Enterprises', 'pc', 0.000000000000000000000000000000, 40.000000000000000000000000000000, 5.000000000000000000000000000000, NULL, NULL, '', '', 42, '{\"purchaseDate\":\"\"}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
(43, 'LED Bulb', 'Packaging', 'ABM Technology', 'pc', 0.000000000000000000000000000000, 3800.000000000000000000000000000000, 1.600000000000000000000000000000, NULL, NULL, '', '', 43, '{\"purchaseDate\":\"\"}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
(44, 'Glue', 'Packaging', 'BG Enterprises', 'pc', 0.000000000000000000000000000000, 1.000000000000000000000000000000, 400.000000000000000000000000000000, NULL, NULL, '', '', 44, '{\"purchaseDate\":\"\"}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
(45, 'Stepler Pins', 'Packaging', 'BG Enterprises', 'pc', 0.000000000000000000000000000000, 6.000000000000000000000000000000, 50.000000000000000000000000000000, NULL, NULL, '', '', 45, '{\"purchaseDate\":\"\"}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000');

-- --------------------------------------------------------

--
-- Table structure for table `raw_material_usage`
--

CREATE TABLE `raw_material_usage` (
  `id` varchar(191) NOT NULL,
  `date` date DEFAULT NULL,
  `material_id` bigint(20) DEFAULT NULL,
  `material_name` text DEFAULT NULL,
  `qty_used` decimal(65,30) DEFAULT NULL,
  `remaining_qty` decimal(65,30) DEFAULT NULL,
  `used_by` text DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `consumed_value` decimal(65,30) DEFAULT NULL,
  `ledger_txn_id` text DEFAULT NULL,
  `position` int(11) NOT NULL DEFAULT 0,
  `extra` longtext NOT NULL DEFAULT '{}' CHECK (json_valid(`extra`)),
  `created_at` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  `updated_at` datetime(6) NOT NULL DEFAULT current_timestamp(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- --------------------------------------------------------

--
-- Table structure for table `sales_orders`
--

CREATE TABLE `sales_orders` (
  `id` varchar(191) NOT NULL,
  `invoice` text DEFAULT NULL,
  `customer_name` text DEFAULT NULL,
  `customer_id` bigint(20) DEFAULT NULL,
  `items` int(11) DEFAULT NULL,
  `amount` decimal(65,30) DEFAULT NULL,
  `tax` decimal(65,30) DEFAULT NULL,
  `status` text DEFAULT NULL,
  `payment` text DEFAULT NULL,
  `date` date DEFAULT NULL,
  `channel` text DEFAULT NULL,
  `attachment` longtext DEFAULT NULL CHECK (json_valid(`attachment`)),
  `amount_paid` decimal(65,30) DEFAULT NULL,
  `accrued` tinyint(1) DEFAULT NULL,
  `is_credit` tinyint(1) DEFAULT NULL,
  `from_delivery` text DEFAULT NULL,
  `note` text DEFAULT NULL,
  `position` int(11) NOT NULL DEFAULT 0,
  `extra` longtext NOT NULL DEFAULT '{}' CHECK (json_valid(`extra`)),
  `created_at` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  `updated_at` datetime(6) NOT NULL DEFAULT current_timestamp(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

--
-- Dumping data for table `sales_orders`
--

INSERT INTO `sales_orders` (`id`, `invoice`, `customer_name`, `customer_id`, `items`, `amount`, `tax`, `status`, `payment`, `date`, `channel`, `attachment`, `amount_paid`, `accrued`, `is_credit`, `from_delivery`, `note`, `position`, `extra`, `created_at`, `updated_at`) VALUES
('SO-1033', 'INV-2452', 'Meridian Office Supplies', NULL, 20, 176400.000000000000000000000000000000, 13066.000000000000000000000000000000, 'Delivered', 'Paid', '2026-07-11', 'Manual', NULL, NULL, NULL, NULL, NULL, NULL, 10, '{\"payments\":null}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
('SO-1034', 'INV-2453', 'Blue Horizon Traders', NULL, 7, 51200.000000000000000000000000000000, 3792.000000000000000000000000000000, 'Delivered', 'Paid', '2026-07-12', 'Manual', NULL, NULL, NULL, NULL, NULL, NULL, 9, '{\"payments\":null}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
('SO-1035', 'INV-2454', 'Golden Star Traders', NULL, 4, 27650.000000000000000000000000000000, 2048.000000000000000000000000000000, 'Cancelled', 'Refunded', '2026-07-12', 'Manual', NULL, NULL, NULL, NULL, NULL, NULL, 8, '{\"payments\":null}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
('SO-1036', 'INV-2455', 'Crescent Business Center', NULL, 11, 94800.000000000000000000000000000000, 7022.000000000000000000000000000000, 'Delivered', 'Paid', '2026-07-13', 'Manual', NULL, NULL, NULL, NULL, NULL, NULL, 7, '{\"payments\":null}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
('SO-1037', 'INV-2456', 'Silverline Enterprises', NULL, 5, 33400.000000000000000000000000000000, 2474.000000000000000000000000000000, 'Processing', 'Pending', '2026-07-14', 'Manual', NULL, NULL, NULL, NULL, NULL, NULL, 6, '{\"payments\":null}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
('SO-1038', 'INV-2457', 'Falcon Print Hub', NULL, 2, 19750.000000000000000000000000000000, 1463.000000000000000000000000000000, 'Shipped', 'Overdue', '2026-07-14', 'Manual', NULL, NULL, NULL, NULL, NULL, NULL, 5, '{\"payments\":null}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
('SO-1039', 'INV-2458', 'Continental Traders', NULL, 9, 62300.000000000000000000000000000000, 4614.000000000000000000000000000000, 'Shipped', 'Paid', '2026-07-15', 'Manual', NULL, NULL, NULL, NULL, NULL, NULL, 4, '{\"payments\":null}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
('SO-1040', 'INV-2459', 'Al Noor Stationery', NULL, 3, 8600.000000000000000000000000000000, 637.000000000000000000000000000000, 'Processing', 'Pending', '2026-07-15', 'Manual', NULL, NULL, NULL, NULL, NULL, NULL, 3, '{\"payments\":null}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
('SO-1041', 'INV-2460', 'Meridian Office Supplies', NULL, 14, 128900.000000000000000000000000000000, 9548.000000000000000000000000000000, 'Delivered', 'Paid', '2026-07-16', 'Manual', NULL, NULL, NULL, NULL, NULL, NULL, 2, '{\"payments\":null}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
('SO-1042', 'INV-2461', 'Golden Star Traders', NULL, 6, 45200.000000000000000000000000000000, 3348.000000000000000000000000000000, 'Delivered', 'Paid', '2026-07-16', 'Manual', NULL, NULL, NULL, NULL, NULL, NULL, 1, '{\"payments\":null}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000');

-- --------------------------------------------------------

--
-- Table structure for table `sales_order_items`
--

CREATE TABLE `sales_order_items` (
  `order_id` varchar(191) NOT NULL,
  `line_no` int(11) NOT NULL,
  `product_id` bigint(20) DEFAULT NULL,
  `name` text DEFAULT NULL,
  `qty` decimal(65,30) DEFAULT NULL,
  `price` decimal(65,30) DEFAULT NULL,
  `unit` text DEFAULT NULL,
  `available_stock` decimal(65,30) DEFAULT NULL,
  `extra` longtext NOT NULL DEFAULT '{}' CHECK (json_valid(`extra`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- --------------------------------------------------------

--
-- Table structure for table `sales_order_payments`
--

CREATE TABLE `sales_order_payments` (
  `order_id` varchar(191) NOT NULL,
  `line_no` int(11) NOT NULL,
  `date` date DEFAULT NULL,
  `amount` decimal(65,30) DEFAULT NULL,
  `extra` longtext NOT NULL DEFAULT '{}' CHECK (json_valid(`extra`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- --------------------------------------------------------

--
-- Table structure for table `schema_migrations`
--

CREATE TABLE `schema_migrations` (
  `name` varchar(191) NOT NULL,
  `applied_at` datetime(6) NOT NULL DEFAULT current_timestamp(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

--
-- Dumping data for table `schema_migrations`
--

INSERT INTO `schema_migrations` (`name`, `applied_at`) VALUES
('001_learnex_schema.sql', '2026-10-13 09:17:05.006766'),
('002_auth.sql', '2026-10-13 09:17:05.066467');

-- --------------------------------------------------------

--
-- Table structure for table `store_state`
--

CREATE TABLE `store_state` (
  `store` varchar(64) NOT NULL,
  `initialized_at` datetime(6) NOT NULL DEFAULT current_timestamp(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

--
-- Dumping data for table `store_state`
--

INSERT INTO `store_state` (`store`, `initialized_at`) VALUES
('cashAccounts', '2026-10-13 05:31:05.387000'),
('customers', '2026-10-13 05:31:05.387000'),
('deliveryRuns', '2026-10-13 05:31:05.387000'),
('ledger', '2026-10-13 05:31:05.387000'),
('products', '2026-10-13 05:31:05.387000'),
('purchaseOrders', '2026-10-13 05:31:05.387000'),
('rawMaterialUsage', '2026-10-13 05:31:05.387000'),
('rawMaterials', '2026-10-13 05:31:05.387000'),
('salesOrders', '2026-10-13 05:31:05.387000'),
('settings', '2026-10-13 05:31:05.387000'),
('suppliers', '2026-10-13 05:31:05.387000'),
('users', '2026-10-13 05:31:05.387000');

-- --------------------------------------------------------

--
-- Table structure for table `suppliers`
--

CREATE TABLE `suppliers` (
  `id` bigint(20) NOT NULL,
  `name` text DEFAULT NULL,
  `contact` text DEFAULT NULL,
  `phone` text DEFAULT NULL,
  `email` text DEFAULT NULL,
  `category` text DEFAULT NULL,
  `status` text DEFAULT NULL,
  `purchased` decimal(65,30) DEFAULT NULL,
  `last_order` date DEFAULT NULL,
  `position` int(11) NOT NULL DEFAULT 0,
  `extra` longtext NOT NULL DEFAULT '{}' CHECK (json_valid(`extra`)),
  `created_at` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  `updated_at` datetime(6) NOT NULL DEFAULT current_timestamp(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

--
-- Dumping data for table `suppliers`
--

INSERT INTO `suppliers` (`id`, `name`, `contact`, `phone`, `email`, `category`, `status`, `purchased`, `last_order`, `position`, `extra`, `created_at`, `updated_at`) VALUES
(1, 'Azure Packaging', '', '', '', 'Raw Materials', 'Active', 0.000000000000000000000000000000, NULL, 1, '{}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
(2, 'Lakro Packaging Industries', '', '', '', 'Raw Materials', 'Active', 0.000000000000000000000000000000, NULL, 2, '{}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
(3, 'Vismass Inkjet', '', '', '', 'Raw Materials', 'Active', 0.000000000000000000000000000000, NULL, 3, '{}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
(4, 'BG Enterprises', '', '', '', 'Raw Materials', 'Active', 0.000000000000000000000000000000, NULL, 4, '{}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
(5, 'Zeylaan Packaging', '', '', '', 'Raw Materials', 'Active', 0.000000000000000000000000000000, NULL, 5, '{}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
(6, 'ABM Technology', '', '', '', 'Raw Materials', 'Active', 0.000000000000000000000000000000, NULL, 6, '{}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000'),
(7, 'I & H Enterprises', '', '', '', 'Raw Materials', 'Active', 0.000000000000000000000000000000, NULL, 7, '{}', '2026-10-13 05:31:05.387000', '2026-10-13 05:31:05.387000');

-- --------------------------------------------------------

--
-- Table structure for table `teams`
--

CREATE TABLE `teams` (
  `id` varchar(191) NOT NULL,
  `name` varchar(191) NOT NULL,
  `description` varchar(191) DEFAULT NULL,
  `code` varchar(191) NOT NULL,
  `CreateAt` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updatedAt` datetime(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `users`
--

CREATE TABLE `users` (
  `id` varchar(191) NOT NULL,
  `email` varchar(191) NOT NULL,
  `password` varchar(191) NOT NULL,
  `name` varchar(191) NOT NULL,
  `role` enum('ADMIN','MANAGER','USER','GUEST') NOT NULL DEFAULT 'USER',
  `teamId` varchar(191) DEFAULT NULL,
  `CreateAt` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updatedAt` datetime(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `users`
--

INSERT INTO `users` (`id`, `email`, `password`, `name`, `role`, `teamId`, `CreateAt`, `updatedAt`) VALUES
('cmrnqttf50000rkv691qp9g37', 'test@gmail.com', '$2b$12$aivP4kLubaoIgeIeGc2YounuCeUnuIbZ55i8cMNQtgfBhVezx1Zie', 'test', 'ADMIN', NULL, '2026-07-16 16:48:36.401', '2026-07-16 16:48:36.401'),
('cmrnqzzpq0001rkv6oatxojln', 'hashil@gmail.com', '$2b$12$V3eDvl/gPCX2t1Ix/TFS4.lpis/sQK4tnmm/2vruu/4iW6GasOX3q', 'hashil', 'USER', NULL, '2026-07-16 16:53:24.494', '2026-07-16 16:53:24.494');

-- --------------------------------------------------------

--
-- Stand-in structure for view `v_ledger`
-- (See below for the actual view)
--
CREATE TABLE `v_ledger` (
`id` varchar(191)
,`date` date
,`description` text
,`type` text
,`category` text
,`kind` text
,`amount` decimal(65,30)
,`signed_amount` decimal(65,30)
,`account` text
,`account_name` text
,`cash` tinyint(1)
);

-- --------------------------------------------------------

--
-- Stand-in structure for view `v_purchase_lines`
-- (See below for the actual view)
--
CREATE TABLE `v_purchase_lines` (
`order_id` varchar(191)
,`date` date
,`supplier_id` bigint(20)
,`supplier_name` text
,`payment_status` text
,`line_no` int(11)
,`material_id` bigint(20)
,`material_name` mediumtext
,`qty` decimal(65,30)
,`cost` decimal(65,30)
,`line_total` decimal(65,38)
);

-- --------------------------------------------------------

--
-- Stand-in structure for view `v_sales_lines`
-- (See below for the actual view)
--
CREATE TABLE `v_sales_lines` (
`order_id` varchar(191)
,`invoice` text
,`date` date
,`customer_id` bigint(20)
,`customer_name` text
,`status` text
,`payment` text
,`line_no` int(11)
,`product_id` bigint(20)
,`product_name` mediumtext
,`sku` text
,`qty` decimal(65,30)
,`price` decimal(65,30)
,`line_total` decimal(65,38)
);

-- --------------------------------------------------------

--
-- Structure for view `v_ledger`
--
DROP TABLE IF EXISTS `v_ledger`;

CREATE ALGORITHM=UNDEFINED DEFINER=`learnex_app`@`localhost` SQL SECURITY INVOKER VIEW `v_ledger`  AS SELECT `l`.`id` AS `id`, `l`.`date` AS `date`, `l`.`description` AS `description`, `l`.`type` AS `type`, `l`.`category` AS `category`, `l`.`kind` AS `kind`, `l`.`amount` AS `amount`, CASE WHEN `l`.`type` = 'Income' THEN `l`.`amount` ELSE -`l`.`amount` END AS `signed_amount`, `l`.`account` AS `account`, `a`.`name` AS `account_name`, `l`.`cash` AS `cash` FROM (`ledger_entries` `l` left join `cash_accounts` `a` on(`a`.`id` = `l`.`account`)) ;

-- --------------------------------------------------------

--
-- Structure for view `v_purchase_lines`
--
DROP TABLE IF EXISTS `v_purchase_lines`;

CREATE ALGORITHM=UNDEFINED DEFINER=`learnex_app`@`localhost` SQL SECURITY INVOKER VIEW `v_purchase_lines`  AS SELECT `o`.`id` AS `order_id`, `o`.`date` AS `date`, `o`.`supplier_id` AS `supplier_id`, `o`.`supplier_name` AS `supplier_name`, `o`.`payment_status` AS `payment_status`, `i`.`line_no` AS `line_no`, `i`.`material_id` AS `material_id`, coalesce(`m`.`name`,`i`.`name`) AS `material_name`, `i`.`qty` AS `qty`, `i`.`cost` AS `cost`, `i`.`qty`* `i`.`cost` AS `line_total` FROM ((`purchase_orders` `o` join `purchase_order_items` `i` on(`i`.`order_id` = `o`.`id`)) left join `raw_materials` `m` on(`m`.`id` = `i`.`material_id`)) ;

-- --------------------------------------------------------

--
-- Structure for view `v_sales_lines`
--
DROP TABLE IF EXISTS `v_sales_lines`;

CREATE ALGORITHM=UNDEFINED DEFINER=`learnex_app`@`localhost` SQL SECURITY INVOKER VIEW `v_sales_lines`  AS SELECT `o`.`id` AS `order_id`, `o`.`invoice` AS `invoice`, `o`.`date` AS `date`, `o`.`customer_id` AS `customer_id`, `o`.`customer_name` AS `customer_name`, `o`.`status` AS `status`, `o`.`payment` AS `payment`, `i`.`line_no` AS `line_no`, `i`.`product_id` AS `product_id`, coalesce(`p`.`name`,`i`.`name`) AS `product_name`, `p`.`sku` AS `sku`, `i`.`qty` AS `qty`, `i`.`price` AS `price`, `i`.`qty`* `i`.`price` AS `line_total` FROM ((`sales_orders` `o` join `sales_order_items` `i` on(`i`.`order_id` = `o`.`id`)) left join `products` `p` on(`p`.`id` = `i`.`product_id`)) ;

--
-- Indexes for dumped tables
--

--
-- Indexes for table `app_meta`
--
ALTER TABLE `app_meta`
  ADD PRIMARY KEY (`key`);

--
-- Indexes for table `app_users`
--
ALTER TABLE `app_users`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `audit_log`
--
ALTER TABLE `audit_log`
  ADD PRIMARY KEY (`id`),
  ADD KEY `audit_log_at_idx` (`at`),
  ADD KEY `audit_log_user_idx` (`user_id`),
  ADD KEY `audit_log_action_idx` (`action`);

--
-- Indexes for table `auth_roles`
--
ALTER TABLE `auth_roles`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `auth_roles_key_key` (`key`),
  ADD UNIQUE KEY `auth_roles_name_key` (`name_key`);

--
-- Indexes for table `auth_role_permissions`
--
ALTER TABLE `auth_role_permissions`
  ADD PRIMARY KEY (`role_id`,`permission`);

--
-- Indexes for table `auth_sessions`
--
ALTER TABLE `auth_sessions`
  ADD PRIMARY KEY (`id`),
  ADD KEY `auth_sessions_user_idx` (`user_id`),
  ADD KEY `auth_sessions_expires_idx` (`expires_at`);

--
-- Indexes for table `auth_users`
--
ALTER TABLE `auth_users`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `auth_users_username_key` (`username_key`),
  ADD UNIQUE KEY `auth_users_email_key` (`email_key`),
  ADD KEY `auth_users_created_by_fk` (`created_by`);

--
-- Indexes for table `auth_user_roles`
--
ALTER TABLE `auth_user_roles`
  ADD PRIMARY KEY (`user_id`,`role_id`),
  ADD KEY `auth_user_roles_role_idx` (`role_id`),
  ADD KEY `auth_user_roles_granted_by_fk` (`granted_by`);

--
-- Indexes for table `business_settings`
--
ALTER TABLE `business_settings`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `cash_accounts`
--
ALTER TABLE `cash_accounts`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `customers`
--
ALTER TABLE `customers`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `delivery_credit_bills`
--
ALTER TABLE `delivery_credit_bills`
  ADD PRIMARY KEY (`run_id`,`line_no`);

--
-- Indexes for table `delivery_runs`
--
ALTER TABLE `delivery_runs`
  ADD PRIMARY KEY (`id`),
  ADD KEY `delivery_runs_date_idx` (`date`);

--
-- Indexes for table `delivery_run_items`
--
ALTER TABLE `delivery_run_items`
  ADD PRIMARY KEY (`run_id`,`line_no`),
  ADD KEY `delivery_run_items_product_idx` (`product_id`);

--
-- Indexes for table `ledger_entries`
--
ALTER TABLE `ledger_entries`
  ADD PRIMARY KEY (`id`),
  ADD KEY `ledger_entries_date_idx` (`date`),
  ADD KEY `ledger_entries_account_idx` (`account`(191)),
  ADD KEY `ledger_entries_kind_idx` (`kind`(191));

--
-- Indexes for table `products`
--
ALTER TABLE `products`
  ADD PRIMARY KEY (`id`),
  ADD KEY `products_sku_idx` (`sku`(191));

--
-- Indexes for table `purchase_orders`
--
ALTER TABLE `purchase_orders`
  ADD PRIMARY KEY (`id`),
  ADD KEY `purchase_orders_date_idx` (`date`),
  ADD KEY `purchase_orders_supplier_idx` (`supplier_id`);

--
-- Indexes for table `purchase_order_items`
--
ALTER TABLE `purchase_order_items`
  ADD PRIMARY KEY (`order_id`,`line_no`),
  ADD KEY `purchase_order_items_material_idx` (`material_id`);

--
-- Indexes for table `raw_materials`
--
ALTER TABLE `raw_materials`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `raw_material_usage`
--
ALTER TABLE `raw_material_usage`
  ADD PRIMARY KEY (`id`),
  ADD KEY `raw_material_usage_material_idx` (`material_id`),
  ADD KEY `raw_material_usage_date_idx` (`date`);

--
-- Indexes for table `sales_orders`
--
ALTER TABLE `sales_orders`
  ADD PRIMARY KEY (`id`),
  ADD KEY `sales_orders_date_idx` (`date`),
  ADD KEY `sales_orders_customer_idx` (`customer_id`),
  ADD KEY `sales_orders_invoice_idx` (`invoice`(191));

--
-- Indexes for table `sales_order_items`
--
ALTER TABLE `sales_order_items`
  ADD PRIMARY KEY (`order_id`,`line_no`),
  ADD KEY `sales_order_items_product_idx` (`product_id`);

--
-- Indexes for table `sales_order_payments`
--
ALTER TABLE `sales_order_payments`
  ADD PRIMARY KEY (`order_id`,`line_no`);

--
-- Indexes for table `schema_migrations`
--
ALTER TABLE `schema_migrations`
  ADD PRIMARY KEY (`name`);

--
-- Indexes for table `store_state`
--
ALTER TABLE `store_state`
  ADD PRIMARY KEY (`store`);

--
-- Indexes for table `suppliers`
--
ALTER TABLE `suppliers`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `teams`
--
ALTER TABLE `teams`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `teams_code_key` (`code`);

--
-- Indexes for table `users`
--
ALTER TABLE `users`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `users_email_key` (`email`),
  ADD KEY `users_email_idx` (`email`),
  ADD KEY `users_role_idx` (`role`),
  ADD KEY `users_teamId_idx` (`teamId`);

--
-- AUTO_INCREMENT for dumped tables
--

--
-- AUTO_INCREMENT for table `app_users`
--
ALTER TABLE `app_users`
  MODIFY `id` bigint(20) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=5;

--
-- AUTO_INCREMENT for table `audit_log`
--
ALTER TABLE `audit_log`
  MODIFY `id` bigint(20) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=10;

--
-- AUTO_INCREMENT for table `auth_roles`
--
ALTER TABLE `auth_roles`
  MODIFY `id` bigint(20) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=6;

--
-- AUTO_INCREMENT for table `auth_users`
--
ALTER TABLE `auth_users`
  MODIFY `id` bigint(20) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=3;

--
-- Constraints for dumped tables
--

--
-- Constraints for table `audit_log`
--
ALTER TABLE `audit_log`
  ADD CONSTRAINT `audit_log_user_fk` FOREIGN KEY (`user_id`) REFERENCES `auth_users` (`id`) ON DELETE SET NULL;

--
-- Constraints for table `auth_role_permissions`
--
ALTER TABLE `auth_role_permissions`
  ADD CONSTRAINT `auth_role_permissions_role_fk` FOREIGN KEY (`role_id`) REFERENCES `auth_roles` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `auth_sessions`
--
ALTER TABLE `auth_sessions`
  ADD CONSTRAINT `auth_sessions_user_fk` FOREIGN KEY (`user_id`) REFERENCES `auth_users` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `auth_users`
--
ALTER TABLE `auth_users`
  ADD CONSTRAINT `auth_users_created_by_fk` FOREIGN KEY (`created_by`) REFERENCES `auth_users` (`id`) ON DELETE SET NULL;

--
-- Constraints for table `auth_user_roles`
--
ALTER TABLE `auth_user_roles`
  ADD CONSTRAINT `auth_user_roles_granted_by_fk` FOREIGN KEY (`granted_by`) REFERENCES `auth_users` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `auth_user_roles_role_fk` FOREIGN KEY (`role_id`) REFERENCES `auth_roles` (`id`),
  ADD CONSTRAINT `auth_user_roles_user_fk` FOREIGN KEY (`user_id`) REFERENCES `auth_users` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `delivery_credit_bills`
--
ALTER TABLE `delivery_credit_bills`
  ADD CONSTRAINT `delivery_credit_bills_run_fk` FOREIGN KEY (`run_id`) REFERENCES `delivery_runs` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `delivery_run_items`
--
ALTER TABLE `delivery_run_items`
  ADD CONSTRAINT `delivery_run_items_run_fk` FOREIGN KEY (`run_id`) REFERENCES `delivery_runs` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `purchase_order_items`
--
ALTER TABLE `purchase_order_items`
  ADD CONSTRAINT `purchase_order_items_order_fk` FOREIGN KEY (`order_id`) REFERENCES `purchase_orders` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `sales_order_items`
--
ALTER TABLE `sales_order_items`
  ADD CONSTRAINT `sales_order_items_order_fk` FOREIGN KEY (`order_id`) REFERENCES `sales_orders` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `sales_order_payments`
--
ALTER TABLE `sales_order_payments`
  ADD CONSTRAINT `sales_order_payments_order_fk` FOREIGN KEY (`order_id`) REFERENCES `sales_orders` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `users`
--
ALTER TABLE `users`
  ADD CONSTRAINT `users_teamId_fkey` FOREIGN KEY (`teamId`) REFERENCES `teams` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
