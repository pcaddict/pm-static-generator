# NCS Partition Manager Helper

A web-based visual tool to create, edit, and visualize `pm_static.yml` partition configuration files for the Nordic nRF Connect SDK (NCS).

This tool helps you understand your device's memory layout, avoid common errors like partition overlaps, and quickly generate configurations for different scenarios.

*(It would be great to add a screenshot of the tool in action here)*

## Features

*   **Visual Layout:** See a clear, graphical representation of your memory regions and partitions, including addresses, sizes, and unused space.
*   **MCU Presets:** Start with pre-configured memory maps for common Nordic SoCs like the nRF9160, nRF52840, and nRF5340.
*   **Partition Templates:** Quickly load common partition schemes, such as:
    *   Standard FOTA (Firmware Over-The-Air) with primary/secondary slots.
    *   FOTA using external flash.
    *   Multi-core setups for the nRF5340.
*   **YAML Import/Export:**
    *   Upload an existing `pm_static.yml` to visualize and modify it.
    *   Generate a clean, correctly formatted `pm_static.yml` file.
    *   "Copy to Clipboard" for easy integration into your NCS project.
*   **Interactive Editor:**
    *   Add, remove, and re-order partitions and groups.
    *   Edit partition properties (name, size, region, device) directly in the UI.
    *   Drag-and-drop to reorder partitions.
    *   Create custom memory regions (e.g., for external flash).
*   **Live Validation:** The tool automatically recalculates the layout and checks for errors like:
    *   Partitions overlapping.
    *   Partitions exceeding memory region boundaries.
    *   Duplicate top-level partition names.

## How to Use

1.  **Open the Tool:** Simply open the `index.html` file in your web browser. No server is needed.

2.  **Choose a Starting Point:**
    *   **For a new project:** Select your target MCU from the dropdown. This will load its default memory regions. Then, select a partition template (e.g., "Fota") to get a common starting configuration.
    *   **For an existing project:** Use the "Upload `pm_static.yml`" button to load your current configuration.

3.  **Edit Partitions:**
    *   Use the "Add Partition" or "Add Group" buttons to create new entries.
    *   Click on any field in the partition list to edit its name, size (e.g., `48K`, `0.5M`, `0x10000`), or region.
    *   Use the `☰` handle to drag and drop partitions to reorder them.

4.  **Visualize the Layout:**
    *   The "Graphical Layout" view on the right updates automatically as you make changes.
    *   This view helps you spot gaps, check alignment, and see how much space is used and free in each memory region.

5.  **Generate the YAML:**
    *   The "Generated `pm_static.yml`" box shows the live output.
    *   Once you are satisfied with your layout, click "Copy to Clipboard" and paste the contents into the `pm_static.yml` file in your NCS project.

## Technical Details

*   **Frontend:** Plain HTML, CSS, and JavaScript. No frameworks.
*   **Dependencies:**
    *   js-yaml for parsing uploaded YAML files. It is loaded via a CDN.

## Disclaimer

*   This application was developed with the help of Google Gemini. 

## Contributing

Contributions are welcome! Feel free to open an issue to report a bug or suggest a feature, or create a pull request to add improvements.

Possible areas for improvement include:
*   Adding more MCU presets and partition templates.
*   More advanced validation rules.
*   Saving/loading the entire tool state to a local file.

## License

This project is open source. Please feel free to add a license file (e.g., MIT License) if you wish to distribute it.