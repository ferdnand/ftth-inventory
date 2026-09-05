-- ============================================================
-- Catalog items (operational SKU list)
-- ============================================================
-- The items seeded by db/seed.js are development fixtures. This migration adds
-- the real field catalog so a deployed database has it without running the seed.
--
-- Names are normalised to the Title Case used by the existing catalog rather
-- than the all-caps of the source list, and model designators are kept as
-- written (RB5009, EAP110, 1x8).
--
-- reorder_threshold is left NULL throughout: a threshold is an operational
-- decision per location, not something to invent here. Set them later with
-- PATCH /api/items/:id.
--
-- The NOT EXISTS guard makes the insert safe to re-run and stops a name that is
-- already in the catalog from being duplicated — items.name has no unique
-- constraint, so nothing else would catch it.

INSERT INTO items (name, category, tracking_type, unit_of_measure, manufacturer, model)
SELECT v.name, v.category, v.tracking_type::tracking_type_enum,
       v.unit_of_measure, v.manufacturer, v.model
FROM (VALUES
    -- Fibre and copper cable, held by length
    ('ADSS Cable 6-core',            'Cable',        'bulk',       'meter', NULL::TEXT, NULL::TEXT),
    ('ADSS Cable 8-core',            'Cable',        'bulk',       'meter', NULL, NULL),
    ('ADSS Cable 12-core',           'Cable',        'bulk',       'meter', NULL, NULL),
    ('Cat 6 Outdoor Cable',          'Cable',        'bulk',       'meter', NULL, NULL),
    ('Drop Cable 2-core',            'Cable',        'bulk',       'meter', NULL, NULL),
    -- Pre-packaged drums, counted as drums rather than metres
    ('Faiba Drop Cable 2-core 1km',  'Cable',        'bulk',       'drum',  'Faiba', NULL),
    ('Faiba Drop Cable 2-core 2km',  'Cable',        'bulk',       'drum',  'Faiba', NULL),

    -- Enclosures and terminals
    ('Adapter Box 255x200x80',       'Enclosure',    'bulk',       'unit',  NULL, NULL),
    ('ATB Loaded',                   'Enclosure',    'bulk',       'unit',  NULL, NULL),
    ('ATB Empty',                    'Enclosure',    'bulk',       'unit',  NULL, NULL),
    ('FAT 1x4',                      'Enclosure',    'bulk',       'unit',  NULL, NULL),
    ('FAT 1x8',                      'Enclosure',    'bulk',       'unit',  NULL, NULL),
    ('Cabinet 4U',                   'Rack',         'bulk',       'unit',  NULL, NULL),
    ('Rack',                         'Rack',         'bulk',       'unit',  NULL, NULL),

    -- Splitters
    ('Splitter 1x2',                 'Splitter',     'bulk',       'unit',  NULL, NULL),
    ('Splitter 1x4',                 'Splitter',     'bulk',       'unit',  NULL, NULL),
    ('Splitter 1x8',                 'Splitter',     'bulk',       'unit',  NULL, NULL),

    -- Network devices. Serialized: each unit carries a serial number and, where
    -- it has one, a MAC, so it can be traced to the premises it ends up at.
    ('EAP110 Access Point',          'Access Point', 'serialized', 'unit',  'TP-Link',  'EAP110'),
    ('Mikrotik L009',                'Router',       'serialized', 'unit',  'MikroTik', 'L009'),
    ('Mikrotik RB5009',              'Router',       'serialized', 'unit',  'MikroTik', 'RB5009'),
    ('Router XPON',                  'Router',       'serialized', 'unit',  NULL, NULL),
    ('Router Tenda F3',              'Router',       'serialized', 'unit',  'Tenda', 'F3'),
    ('Gigabit Switch',               'Switch',       'serialized', 'unit',  NULL, NULL),
    ('OLT Hioso 4-port',             'OLT',          'serialized', 'unit',  'Hioso', '4-port'),

    -- Patch cords and connectors
    ('Faiba Patch Cord',             'Patch Cord',   'bulk',       'unit',  'Faiba', NULL),
    ('Patch Cords',                  'Patch Cord',   'bulk',       'unit',  NULL, NULL),
    ('RJ45 Connector',               'Connector',    'bulk',       'unit',  NULL, NULL),

    -- Consumables
    ('Sleeves',                      'Consumable',   'bulk',       'unit',  NULL, NULL),
    ('Electrician Tape',             'Consumable',   'bulk',       'roll',  NULL, NULL),
    ('Steel Nails',                  'Consumable',   'bulk',       'unit',  NULL, NULL),
    ('Tie Wraps',                    'Consumable',   'bulk',       'unit',  NULL, NULL),

    -- Accessories, tools and infrastructure
    ('Ethernet Adapter',             'Accessory',    'bulk',       'unit',  NULL, NULL),
    ('Top Plug',                     'Accessory',    'bulk',       'unit',  NULL, NULL),
    ('Bedswitch',                    'Accessory',    'bulk',       'unit',  NULL, NULL),
    ('Fiber Toolkit',                'Tool',         'bulk',       'unit',  NULL, NULL),
    ('Electric Poles',               'Infrastructure','bulk',      'unit',  NULL, NULL),
    ('TSPE',                         'Other',        'bulk',       'unit',  NULL, NULL),

    -- Billable labour. These are not stock: they are catalogued so an
    -- installation can record what work was done alongside what was consumed.
    -- No stock_levels rows are created for them, so they stay at zero on hand.
    ('Splicing',                     'Service',      'bulk',       'job',   NULL, NULL),
    ('Cable Run',                    'Service',      'bulk',       'meter', NULL, NULL),
    ('Starlink Mounting',            'Service',      'bulk',       'job',   NULL, NULL),
    ('Hotspot Router Setup',         'Service',      'bulk',       'job',   NULL, NULL),
    ('PPPoE Client Setup',           'Service',      'bulk',       'job',   NULL, NULL),
    ('Billing System Configuration', 'Service',      'bulk',       'job',   NULL, NULL)
) AS v(name, category, tracking_type, unit_of_measure, manufacturer, model)
WHERE NOT EXISTS (
    SELECT 1 FROM items i WHERE lower(i.name) = lower(v.name)
);
