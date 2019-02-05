# -*- coding: utf-8 -*-
{
    "name": "Dynamic Selection Widget",
    "version": "11.0.1.0.1",
    "category": "Extra Tools",
    "author": "Odoo Tools",
    "website": "https://odootools.com/apps/11.0/dynamic-selection-widget-26",
    "license": "AGPL-3",
    "application": False,
    "installable": True,
    "auto_install": False,
    "depends": [
        
    ],
    "data": [
        "data/data.xml",
        "views/assets_backend.xml",
        "security/ir.model.access.csv"
    ],
    "qweb": [
        
    ],
    "js": [
        
    ],
    "demo": [
        
    ],
    "external_dependencies": {},
    "summary": "A special widget to select among undefined classifier values",
    "description": """
    The app is a technical module to construct dynamic views for <strong> undefined</strong> classifiers, using 'model_name' (Odoo object name) and 'integer' (Database id) as parameters. The final integer field would look like a mere many2one field.

""",
    "images": [
        "static/description/main.png"
    ],
    "price": "0.0",
    "currency": "EUR",
}