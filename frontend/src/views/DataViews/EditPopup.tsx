import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import TextField from '@mui/material/TextField';
import { Button } from '@mui/material';
import { useEffect, useState } from 'react';
import MenuItem from '@mui/material/MenuItem';
import FormControl from '@mui/material/FormControl';
import Select, { SelectChangeEvent } from '@mui/material/Select';


const EditPopup = (props) => {

    const { open, handleClose, data, addNew, title } = props;
    const [updatedConnection, setUpdatedConnection] = useState(props.data);

    useEffect(() => {
        setUpdatedConnection(data);
    }, [data])

    const saveConnection = () => {
        console.log('want to save connection -- > ', updatedConnection);
    }

    const createConnection = () => {
        console.log('want to create connection -- > ', updatedConnection);
    }

    const cancelConnectionEdit = () => {
        setUpdatedConnection(props.data);
        handleClose();
    }

    return (
        <Dialog
            open={open}
            onClose={handleClose}
            fullWidth={true}
            maxWidth='md'
            aria-labelledby="alert-dialog-title"
            aria-describedby="alert-dialog-description"
        >
            <DialogTitle id="alert-dialog-title">{title}</DialogTitle>
            <DialogContent>
                <div className='section'>
                    <DialogContentText id="alert-dialog-description">
                        Code:
                    </DialogContentText>
                    <TextField
                        autoFocus
                        fullWidth
                        margin="dense"
                        id="code"
                        name="code"
                        type="string"
                        value={updatedConnection?.code}
                        onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                            setUpdatedConnection((prevState: any) => ({...prevState, code: event.target.value}));
                        }}
                        variant="standard"
                    />
                </div>
                <div className='section'>
                    <DialogContentText id="alert-dialog-description">
                        To:
                    </DialogContentText>
                    <TextField
                        autoFocus
                        fullWidth
                        margin="dense"
                        id="to"
                        name="to"
                        type="string"
                        value={updatedConnection?.to}
                        onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                            setUpdatedConnection((prevState: any) => ({...prevState, to: event.target.value}));
                        }}
                        variant="standard"
                    />
                </div>
                <div className='section'>
                    <DialogContentText id="alert-dialog-description" style={{width: '85px'}}>
                        To Etasu:
                    </DialogContentText>
                    <TextField
                        autoFocus
                        fullWidth
                        margin="dense"
                        id="toEtasu"
                        name="toEtasu"
                        type="string"
                        value={updatedConnection?.toEtasu}
                        onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                            setUpdatedConnection((prevState: any) => ({...prevState, toEtasu: event.target.value}));
                        }}
                        variant="standard"
                    />
                </div>
                <div className='section'>
                    <DialogContentText id="alert-dialog-description">
                        From:
                    </DialogContentText>
                    <TextField
                        autoFocus
                        fullWidth
                        margin="dense"
                        id="from"
                        name="from"
                        type="string"
                        value={updatedConnection?.from}
                        onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                            setUpdatedConnection((prevState: any) => ({...prevState, from: event.target.value}));
                        }}
                        variant="standard"
                    />
                </div>
                <div className='section'>
                    <DialogContentText id="alert-dialog-description">
                        System:
                    </DialogContentText>
                    <FormControl fullWidth>
                        <Select
                            labelId="demo-simple-select-label"
                            id="demo-simple-select"
                            value={updatedConnection?.system}
                            onChange={(event: SelectChangeEvent) => {
                                setUpdatedConnection((prevState: any) => ({...prevState, system: event.target.value}));
                            }}
                            >
                                <MenuItem value={"http://hl7.org/fhir/sid/ndc"}>NDC</MenuItem>
                                <MenuItem value={"http://www.nlm.nih.gov/research/umls/rxnorm"}>RXNorm</MenuItem>
                                <MenuItem value={"http://snomed.info/sct"}>SNOMED</MenuItem>
                        </Select>
                    </FormControl>
                </div>
            </DialogContent>
            <DialogActions>
                <Button onClick={cancelConnectionEdit}>Cancel</Button>
                { addNew ? 
                    <Button onClick={createConnection} autoFocus>
                        Create
                    </Button>
                : 
                    <Button onClick={saveConnection} autoFocus>
                        Save
                    </Button>
                }
            </DialogActions>
      </Dialog>
    )
};

export default EditPopup;