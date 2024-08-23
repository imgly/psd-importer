# Contribution Guide

## Getting Started

### Prerequisites

- `yarn` for running and building the project: [Yarn Installation Guide](https://classic.yarnpkg.com/lang/en/docs/install/)

### Development

1. Clone the repository.
2. Install dependencies with `yarn install`.
3. Create a `.env` file.
4. Set your license environment variable in the `.env` file as `CESDK_LICENSE`.
5. Run the tests with `yarn test`. This will transform all PSD files in `test/examples` to PNG files exported via CE.SDK to `test/output/examples`.
6. Run `yarn run compare`. This will read every PSD file in `test/examples` sub-folders and export comparable outputs to `test/output/comparison`.
