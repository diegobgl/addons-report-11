Example of use
===============
.. code:: python

    model_id = fields.Many2one('ir.model', string='Model')
    model_name = fields.Char(related='model_id.model')
    choice = fields.Integer(string=_('My choice'))


.. code:: xml

    <field name="model_id"/>
    <field name="model_name" readonly="1"/>
    <field name="choice" widget="genialSelection"/>